const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const DB = {
  users: path.join(__dirname, "users.json"),
  jobs: path.join(__dirname, "jobs.json"),
  applications: path.join(__dirname, "applications.json"),
  saved: path.join(__dirname, "saved.json"),
  messages: path.join(__dirname, "messages.json"),
  notifications: path.join(__dirname, "notifications.json")
};

function load(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data;
  } catch (e) {
    return fallback;
  }
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = load(DB.users, []);
let jobs = load(DB.jobs, []);
let applications = load(DB.applications, []);
let saved = load(DB.saved, []);
let messages = load(DB.messages, []);
let notifications = load(DB.notifications, []);

function id() {
  return Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
}

function hash(pin) {
  return crypto
    .createHash("sha256")
    .update(String(pin))
    .digest("hex");
}

function clean(v) {
  return String(v || "").trim();
}

function publicUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    location: u.location || "",
    avatar: u.avatar || "",
    skills: u.skills || "",
    bio: u.bio || "",
    cv: u.cv || "",
    verified: !!u.verified,
    rating: Number(u.rating || 0)
  };
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 4 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function findUser(phone, pin) {
  const u = users.find(x => x.phone === clean(phone));

  if (!u) return null;

  if (pin !== undefined && u.pin !== hash(pin)) {
    return null;
  }

  return u;
}

function notify(phone, title, message) {
  notifications.push({
    id: id(),
    phone,
    title,
    message,
    read: false,
    createdAt: Date.now()
  });

  save(DB.notifications, notifications);
}

function dataUrlOK(value, maxKB = 700) {
  if (!value) return true;

  if (typeof value !== "string") return false;

  if (!value.startsWith("data:image/")) return false;

  if (value.length > maxKB * 1024 * 1.4) {
    return false;
  }

  return true;
}

function jobScore(job, user) {
  if (!user) return 0;

  let score = 0;

  const location = clean(user.location).toLowerCase();
  const skills = clean(user.skills)
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean);

  const text = (
    job.title +
    " " +
    job.description +
    " " +
    job.category +
    " " +
    job.location
  ).toLowerCase();

  if (location && text.includes(location)) {
    score += 40;
  }

  skills.forEach(skill => {
    if (skill.length > 1 && text.includes(skill)) {
      score += 10;
    }
  });

  if (
    location &&
    clean(job.location).toLowerCase() === location
  ) {
    score += 30;
  }

  return Math.min(100, score);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
    });

    return res.end();
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const pathname = url.pathname;

  try {

    /* =========================
       HOME
    ========================= */

    if (pathname === "/" && req.method === "GET") {
      const file = path.join(__dirname, "index.html");

      if (!fs.existsSync(file)) {
        return json(res, 404, {
          error: "index.html পাওয়া যায়নি"
        });
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      return res.end(
        fs.readFileSync(file)
      );
    }

    /* =========================
       HEALTH
    ========================= */

    if (pathname === "/health") {
      return json(res, 200, {
        ok: true,
        message: "কাজ খুঁজি server চলছে",
        time: new Date().toISOString()
      });
    }

    /* =========================
       REGISTER
    ========================= */

    if (
      pathname === "/api/register" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const name = clean(body.name);
      const phone = clean(body.phone);
      const pin = clean(body.pin);
      const location = clean(body.location);
      const skills = clean(body.skills);
      const avatar = clean(body.avatar);

      if (!name || !phone || !pin) {
        return json(res, 400, {
          error: "নাম, ফোন এবং PIN দিন"
        });
      }

      if (!/^\d{6}$/.test(pin)) {
        return json(res, 400, {
          error: "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
        });
      }

      if (users.some(u => u.phone === phone)) {
        return json(res, 409, {
          error: "এই ফোন নম্বর দিয়ে ইতিমধ্যে account আছে"
        });
      }

      if (!dataUrlOK(avatar, 350)) {
        return json(res, 400, {
          error: "Profile picture খুব বড়"
        });
      }

      const user = {
        id: id(),
        name,
        phone,
        pin: hash(pin),
        location,
        skills,
        avatar,
        bio: "",
        cv: "",
        verified: false,
        rating: 0,
        createdAt: Date.now()
      };

      users.push(user);
      save(DB.users, users);

      return json(res, 201, {
        success: true,
        user: publicUser(user)
      });
    }

    /* =========================
       LOGIN
    ========================= */

    if (
      pathname === "/api/login" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "ফোন অথবা PIN ভুল"
        });
      }

      return json(res, 200, {
        success: true,
        user: publicUser(user)
      });
    }

    /* =========================
       PROFILE GET
    ========================= */

    if (
      pathname === "/api/profile" &&
      req.method === "GET"
    ) {
      const phone = clean(
        url.searchParams.get("phone")
      );

      const user = users.find(
        u => u.phone === phone
      );

      if (!user) {
        return json(res, 404, {
          error: "User পাওয়া যায়নি"
        });
      }

      return json(res, 200, {
        user: publicUser(user)
      });
    }

    /* =========================
       PROFILE UPDATE
       INCLUDING PROFILE IMAGE
    ========================= */

    if (
      pathname === "/api/profile" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      if (
        body.avatar !== undefined &&
        !dataUrlOK(body.avatar, 350)
      ) {
        return json(res, 400, {
          error: "ছবির size বেশি। ছোট ছবি দিন।"
        });
      }

      if (body.name !== undefined) {
        user.name = clean(body.name);
      }

      if (body.location !== undefined) {
        user.location = clean(body.location);
      }

      if (body.skills !== undefined) {
        user.skills = clean(body.skills);
      }

      if (body.bio !== undefined) {
        user.bio = clean(body.bio);
      }

      if (body.cv !== undefined) {
        user.cv = clean(body.cv);
      }

      /* PROFILE PICTURE SAVE */

      if (body.avatar !== undefined) {
        user.avatar = body.avatar || "";
      }

      save(DB.users, users);

      return json(res, 200, {
        success: true,
        message: "Profile update হয়েছে",
        user: publicUser(user)
      });
    }

    /* =========================
       JOB LIST
    ========================= */

    if (
      pathname === "/api/jobs" &&
      req.method === "GET"
    ) {
      let result = [...jobs];

      const q = clean(
        url.searchParams.get("q")
      ).toLowerCase();

      const location = clean(
        url.searchParams.get("location")
      ).toLowerCase();

      const category = clean(
        url.searchParams.get("category")
      ).toLowerCase();

      const match = url.searchParams.get("match");
      const phone = clean(
        url.searchParams.get("phone")
      );

      if (q) {
        result = result.filter(j =>
          (
            j.title +
            " " +
            j.description +
            " " +
            j.category +
            " " +
            j.location
          )
            .toLowerCase()
            .includes(q)
        );
      }

      if (location) {
        result = result.filter(j =>
          clean(j.location)
            .toLowerCase()
            .includes(location)
        );
      }

      if (category) {
        result = result.filter(j =>
          clean(j.category)
            .toLowerCase()
            .includes(category)
        );
      }

      const user = users.find(
        u => u.phone === phone
      );

      result = result.map(j => ({
        ...j,
        matchScore:
          match === "1"
            ? jobScore(j, user)
            : 0
      }));

      result.sort(
        (a, b) =>
          (b.matchScore || 0) -
          (a.matchScore || 0) ||
          b.createdAt - a.createdAt
      );

      return json(res, 200, {
        jobs: result
      });
    }

    /* =========================
       CREATE JOB
    ========================= */

    if (
      pathname === "/api/jobs" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const title = clean(body.title);
      const location = clean(body.location);
      const salary = clean(body.salary);
      const category = clean(body.category);
      const description = clean(body.description);
      const image = clean(body.image);

      if (!title || !location || !description) {
        return json(res, 400, {
          error: "Job title, location ও description দিন"
        });
      }

      if (!dataUrlOK(image, 700)) {
        return json(res, 400, {
          error: "Job image খুব বড়"
        });
      }

      const job = {
        id: id(),
        title,
        location,
        salary,
        category,
        description,
        image,
        ownerPhone: user.phone,
        ownerName: user.name,
        ownerAvatar: user.avatar || "",
        ownerVerified: !!user.verified,
        createdAt: Date.now()
      };

      jobs.push(job);
      save(DB.jobs, jobs);

      return json(res, 201, {
        success: true,
        job
      });
    }

    /* =========================
       DELETE JOB
    ========================= */

    if (
      pathname === "/api/jobs" &&
      req.method === "DELETE"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const index = jobs.findIndex(
        j =>
          j.id === body.id &&
          j.ownerPhone === user.phone
      );

      if (index === -1) {
        return json(res, 404, {
          error: "Job পাওয়া যায়নি"
        });
      }

      jobs.splice(index, 1);
      save(DB.jobs, jobs);

      return json(res, 200, {
        success: true
      });
    }

    /* =========================
       APPLY JOB
    ========================= */

    if (
      pathname === "/api/apply" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const applicant = findUser(
        body.phone,
        body.pin
      );

      if (!applicant) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const job = jobs.find(
        j => j.id === body.jobId
      );

      if (!job) {
        return json(res, 404, {
          error: "Job পাওয়া যায়নি"
        });
      }

      if (job.ownerPhone === applicant.phone) {
        return json(res, 400, {
          error: "নিজের Job-এ আবেদন করা যাবে না"
        });
      }

      const already = applications.find(
        a =>
          a.jobId === job.id &&
          a.applicantPhone === applicant.phone
      );

      if (already) {
        return json(res, 409, {
          error: "আপনি ইতিমধ্যে আবেদন করেছেন"
        });
      }

      const application = {
        id: id(),
        jobId: job.id,
        jobTitle: job.title,
        applicantPhone: applicant.phone,
        applicantName: applicant.name,
        applicantAvatar: applicant.avatar || "",
        employerPhone: job.ownerPhone,
        cv: applicant.cv || "",
        note: clean(body.note),
        status: "আবেদন করা হয়েছে",
        createdAt: Date.now()
      };

      applications.push(application);
      save(DB.applications, applications);

      notify(
        job.ownerPhone,
        "নতুন আবেদন",
        applicant.name +
          " আপনার \"" +
          job.title +
          "\" Job-এ আবেদন করেছেন।"
      );

      return json(res, 201, {
        success: true,
        application
      });
    }

    /* =========================
       APPLICATIONS
    ========================= */

    if (
      pathname === "/api/applications" &&
      req.method === "GET"
    ) {
      const phone = clean(
        url.searchParams.get("phone")
      );

      const mode = clean(
        url.searchParams.get("mode")
      );

      let result;

      if (mode === "employer") {
        result = applications.filter(
          a => a.employerPhone === phone
        );
      } else {
        result = applications.filter(
          a => a.applicantPhone === phone
        );
      }

      result.sort(
        (a, b) => b.createdAt - a.createdAt
      );

      return json(res, 200, {
        applications: result
      });
    }

    /* =========================
       APPLICATION STATUS
    ========================= */

    if (
      pathname === "/api/application/status" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const employer = findUser(
        body.phone,
        body.pin
      );

      if (!employer) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const application = applications.find(
        a =>
          a.id === body.id &&
          a.employerPhone === employer.phone
      );

      if (!application) {
        return json(res, 404, {
          error: "Application পাওয়া যায়নি"
        });
      }

      application.status = clean(body.status);

      save(DB.applications, applications);

      notify(
        application.applicantPhone,
        "আবেদনের আপডেট",
        application.jobTitle +
          " এর আবেদন: " +
          application.status
      );

      return json(res, 200, {
        success: true,
        application
      });
    }

    /* =========================
       SAVE JOB
    ========================= */

    if (
      pathname === "/api/save" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const existing = saved.find(
        x =>
          x.phone === user.phone &&
          x.jobId === body.jobId
      );

      if (existing) {
        saved = saved.filter(
          x => x !== existing
        );

        save(DB.saved, saved);

        return json(res, 200, {
          saved: false
        });
      }

      saved.push({
        id: id(),
        phone: user.phone,
        jobId: body.jobId,
        createdAt: Date.now()
      });

      save(DB.saved, saved);

      return json(res, 200, {
        saved: true
      });
    }

    /* =========================
       SAVED JOBS
    ========================= */

    if (
      pathname === "/api/saved" &&
      req.method === "GET"
    ) {
      const phone = clean(
        url.searchParams.get("phone")
      );

      const ids = saved
        .filter(x => x.phone === phone)
        .map(x => x.jobId);

      const result = jobs.filter(
        j => ids.includes(j.id)
      );

      return json(res, 200, {
        jobs: result
      });
    }

    /* =========================
       SEND MESSAGE
    ========================= */

    if (
      pathname === "/api/message" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      const user = findUser(
        body.phone,
        body.pin
      );

      if (!user) {
        return json(res, 401, {
          error: "Login তথ্য ভুল"
        });
      }

      const to = clean(body.to);
      const message = clean(body.message);

      if (!to || !message) {
        return json(res, 400, {
          error: "Message লিখুন"
        });
      }

      const item = {
        id: id(),
        from: user.phone,
        to,
        senderName: user.name,
        message,
        createdAt: Date.now()
      };

      messages.push(item);
      save(DB.messages, messages);

      notify(
        to,
        "নতুন Message",
        user.name + " আপনাকে Message পাঠিয়েছেন।"
      );

      return json(res, 201, {
        success: true,
        message: item
      });
    }

    /* =========================
       MESSAGE LIST
    ========================= */

    if (
      pathname === "/api/messages" &&
      req.method === "GET"
    ) {
      const phone = clean(
        url.searchParams.get("phone")
      );

      const withPhone = clean(
        url.searchParams.get("with")
      );

      const result = messages.filter(
        m =>
          (
            m.from === phone &&
            m.to === withPhone
          ) ||
          (
            m.from === withPhone &&
            m.to === phone
          )
      );

      return json(res, 200, {
        messages: result
      });
    }

    /* =========================
       NOTIFICATIONS
    ========================= */

    if (
      pathname === "/api/notifications" &&
      req.method === "GET"
    ) {
      const phone = clean(
        url.searchParams.get("phone")
      );

      const result = notifications
        .filter(x => x.phone === phone)
        .sort(
          (a, b) => b.createdAt - a.createdAt
        );

      return json(res, 200, {
        notifications: result
      });
    }

    /* =========================
       READ NOTIFICATIONS
    ========================= */

    if (
      pathname === "/api/notifications/read" &&
      req.method === "POST"
    ) {
      const body = await readBody(req);

      notifications.forEach(n => {
        if (n.phone === body.phone) {
          n.read = true;
        }
      });

      save(DB.notifications, notifications);

      return json(res, 200, {
        success: true
      });
    }

    /* =========================
       USER SEARCH
    ========================= */

    if (
      pathname === "/api/search" &&
      req.method === "GET"
    ) {
      const q = clean(
        url.searchParams.get("q")
      ).toLowerCase();

      const result = users
        .filter(u =>
          (
            u.name +
            " " +
            u.phone +
            " " +
            u.location +
            " " +
            u.skills
          )
            .toLowerCase()
            .includes(q)
        )
        .map(publicUser);

      return json(res, 200, {
        users: result
      });
    }

    /* =========================
       404
    ========================= */

    return json(res, 404, {
      error: "Not Found"
    });

  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error: error.message || "Server Error"
    });
  }
});

server.listen(PORT, () => {
  console.log(
    "কাজ খুঁজি server started on port " + PORT
  );
});