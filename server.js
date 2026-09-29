const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const DB = {
  users: path.join(__dirname, "users.json"),
  jobs: path.join(__dirname, "jobs.json"),
  messages: path.join(__dirname, "messages.json"),
  notifications: path.join(__dirname, "notifications.json"),
  applications: path.join(__dirname, "applications.json"),
  saved: path.join(__dirname, "saved.json"),
  ratings: path.join(__dirname, "ratings.json"),
  alerts: path.join(__dirname, "alerts.json"),
  interviews: path.join(__dirname, "interviews.json")
};

const MAX_BODY = 2 * 1024 * 1024;
const MAX_AVATAR = 350 * 1024;
const MAX_JOB_IMAGE = 700 * 1024;

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const text = fs.readFileSync(file, "utf8");

    if (!text.trim()) return fallback;

    return JSON.parse(text);
  } catch (e) {
    console.error("DB READ ERROR:", e.message);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("DB SAVE ERROR:", e.message);
    return false;
  }
}

let users = loadJSON(DB.users, []);
let jobs = loadJSON(DB.jobs, []);
let messages = loadJSON(DB.messages, []);
let notifications = loadJSON(DB.notifications, []);
let applications = loadJSON(DB.applications, []);
let saved = loadJSON(DB.saved, []);
let ratings = loadJSON(DB.ratings, []);
let alerts = loadJSON(DB.alerts, []);
let interviews = loadJSON(DB.interviews, []);

function clean(v) {
  return String(v ?? "").trim();
}

function normalize(v) {
  return clean(v)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function id(prefix) {
  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto.randomBytes(5).toString("hex")
  );
}

function hashPIN(pin) {
  return crypto
    .createHash("sha256")
    .update(String(pin))
    .digest("hex");
}

function validPIN(pin) {
  return /^\d{6}$/.test(clean(pin));
}

function userByPhone(phone) {
  return users.find(u => u.phone === clean(phone));
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    location: user.location,
    avatar: user.avatar || "",
    verified: !!user.verified,
    skills: user.skills || "",
    bio: user.bio || "",
    cv: user.cv || "",
    rating: getUserRating(user.phone)
  };
}

function getUserRating(phone) {
  const list = ratings.filter(r => r.to === phone);

  if (!list.length) {
    return {
      average: 0,
      count: 0
    };
  }

  const total = list.reduce((sum, r) => sum + Number(r.rating || 0), 0);

  return {
    average: Number((total / list.length).toFixed(1)),
    count: list.length
  };
}

function imageValid(value, maxSize) {
  if (!value) return true;

  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value)) {
    return false;
  }

  const base64 = value.split(",")[1] || "";

  const bytes = Math.ceil((base64.length * 3) / 4);

  return bytes <= maxSize;
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });

  res.end(JSON.stringify(data));
}

function sendHTML(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > MAX_BODY) {
        reject(new Error("REQUEST_TOO_LARGE"));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });

    req.on("error", reject);
  });
}

function locationMatch(jobLocation, searchLocation) {
  const job = normalize(jobLocation);
  const search = normalize(searchLocation);

  if (!search) return true;
  if (!job) return false;

  if (job.includes(search)) return true;
  if (search.includes(job)) return true;

  const a = job.split(/[,\s]+/).filter(Boolean);
  const b = search.split(/[,\s]+/).filter(Boolean);

  return b.some(x => x.length >= 2 && a.includes(x));
}

function notify(phone, type, title, text, from = "") {
  notifications.unshift({
    id: id("notification"),
    phone,
    type,
    title,
    text,
    from,
    read: false,
    createdAt: new Date().toISOString()
  });

  if (notifications.length > 10000) {
    notifications = notifications.slice(0, 10000);
  }

  saveJSON(DB.notifications, notifications);
}

function jobScore(job, user) {
  let score = 0;

  const text = normalize(
    [
      job.title,
      job.category,
      job.description,
      job.location
    ].join(" ")
  );

  const location = normalize(user?.location);

  if (location && text.includes(location)) {
    score += 40;
  }

  const skills = normalize(user?.skills || "");

  if (skills) {
    const words = skills
      .split(/[,\s]+/)
      .filter(x => x.length > 2);

    for (const word of words) {
      if (text.includes(word)) score += 10;
    }
  }

  if (normalize(job.location) === location) {
    score += 30;
  }

  return Math.min(score, 100);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });

      res.end();
      return;
    }

    /* HOME */

    if (req.method === "GET" && req.url === "/") {
      const file = path.join(__dirname, "index.html");

      if (fs.existsSync(file)) {
        sendHTML(res, fs.readFileSync(file, "utf8"));
      } else {
        sendHTML(res, "<h1>কাজ খুঁজি</h1>");
      }

      return;
    }

    /* HEALTH */

    if (req.method === "GET" && req.url === "/health") {
      sendJSON(res, 200, {
        success: true,
        app: "কাজ খুঁজি",
        status: "ok",
        users: users.length,
        jobs: jobs.length,
        applications: applications.length,
        saved: saved.length,
        messages: messages.length,
        notifications: notifications.length,
        time: new Date().toISOString()
      });

      return;
    }

    /* REGISTER */

    if (req.method === "POST" && req.url === "/api/register") {
      const body = await readBody(req);

      const name = clean(body.name);
      const phone = clean(body.phone);
      const location = clean(body.location);
      const pin = clean(body.pin);
      const avatar = clean(body.avatar);

      if (!name || !phone || !location || !pin) {
        sendJSON(res, 400, {
          success: false,
          message: "সব তথ্য পূরণ করুন"
        });
        return;
      }

      if (!validPIN(pin)) {
        sendJSON(res, 400, {
          success: false,
          message: "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
        });
        return;
      }

      if (!imageValid(avatar, MAX_AVATAR)) {
        sendJSON(res, 400, {
          success: false,
          message: "প্রোফাইল ছবির সাইজ বা ফরম্যাট সঠিক নয়"
        });
        return;
      }

      if (userByPhone(phone)) {
        sendJSON(res, 409, {
          success: false,
          message: "এই মোবাইল নম্বর দিয়ে অ্যাকাউন্ট আছে"
        });
        return;
      }

      const user = {
        id: id("user"),
        name,
        phone,
        location,
        pinHash: hashPIN(pin),
        avatar,
        verified: false,
        skills: "",
        bio: "",
        cv: "",
        createdAt: new Date().toISOString()
      };

      users.push(user);

      saveJSON(DB.users, users);

      sendJSON(res, 200, {
        success: true,
        message: "অ্যাকাউন্ট তৈরি হয়েছে",
        user: publicUser(user)
      });

      return;
    }

    /* LOGIN */

    if (req.method === "POST" && req.url === "/api/login") {
      const body = await readBody(req);

      const phone = clean(body.phone);
      const pin = clean(body.pin);

      const user = userByPhone(phone);

      if (!user) {
        sendJSON(res, 401, {
          success: false,
          message: "অ্যাকাউন্ট পাওয়া যায়নি"
        });
        return;
      }

      if (!validPIN(pin) || user.pinHash !== hashPIN(pin)) {
        sendJSON(res, 401, {
          success: false,
          message: "ভুল PIN"
        });
        return;
      }

      sendJSON(res, 200, {
        success: true,
        message: "লগইন সফল",
        user: publicUser(user)
      });

      return;
    }

    /* PROFILE GET */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/profile")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));
      const user = userByPhone(phone);

      if (!user) {
        sendJSON(res, 404, {
          success: false,
          message: "ব্যবহারকারী পাওয়া যায়নি"
        });
        return;
      }

      const jobCount = jobs.filter(
        j => j.phone === phone
      ).length;

      const applicationCount = applications.filter(
        a => a.applicantPhone === phone
      ).length;

      sendJSON(res, 200, {
        success: true,
        user: publicUser(user),
        jobCount,
        applicationCount
      });

      return;
    }

    /* PROFILE UPDATE */

    if (
      req.method === "POST" &&
      req.url === "/api/profile"
    ) {
      const body = await readBody(req);

      const phone = clean(body.phone);
      const pin = clean(body.pin);

      const user = userByPhone(phone);

      if (!user) {
        sendJSON(res, 404, {
          success: false,
          message: "ব্যবহারকারী পাওয়া যায়নি"
        });
        return;
      }

      if (user.pinHash !== hashPIN(pin)) {
        sendJSON(res, 401, {
          success: false,
          message: "ভুল PIN"
        });
        return;
      }

      if (body.name) user.name = clean(body.name);
      if (body.location) user.location = clean(body.location);
      if (body.skills !== undefined) user.skills = clean(body.skills);
      if (body.bio !== undefined) user.bio = clean(body.bio);
      if (body.cv !== undefined) user.cv = clean(body.cv);

      if (body.avatar) {
        if (!imageValid(body.avatar, MAX_AVATAR)) {
          sendJSON(res, 400, {
            success: false,
            message: "ছবির সাইজ বা ফরম্যাট সঠিক নয়"
          });
          return;
        }

        user.avatar = body.avatar;
      }

      saveJSON(DB.users, users);

      jobs.forEach(job => {
        if (job.phone === phone) {
          job.ownerName = user.name;
          job.ownerAvatar = user.avatar || "";
        }
      });

      saveJSON(DB.jobs, jobs);

      sendJSON(res, 200, {
        success: true,
        message: "প্রোফাইল আপডেট হয়েছে",
        user: publicUser(user)
      });

      return;
    }

    /* JOB LIST */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/jobs")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const location = clean(url.searchParams.get("location"));
      const category = clean(url.searchParams.get("category"));
      const q = clean(url.searchParams.get("q"));
      const phone = clean(url.searchParams.get("phone"));
      const match = url.searchParams.get("match") === "1";

      let result = [...jobs];

      if (location) {
        result = result.filter(j =>
          locationMatch(j.location, location)
        );
      }

      if (category && category !== "সব") {
        result = result.filter(
          j => normalize(j.category) === normalize(category)
        );
      }

      if (q) {
        const search = normalize(q);

        result = result.filter(j => {
          const text = normalize(
            [
              j.title,
              j.location,
              j.category,
              j.description,
              j.ownerName
            ].join(" ")
          );

          return text.includes(search);
        });
      }

      if (match && phone) {
        const user = userByPhone(phone);

        if (user) {
          result = result.map(j => ({
            ...j,
            matchScore: jobScore(j, user)
          }));

          result.sort(
            (a, b) => b.matchScore - a.matchScore
          );
        }
      } else {
        result.sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );
      }

      sendJSON(res, 200, {
        success: true,
        count: result.length,
        jobs: result
      });

      return;
    }

    /* CREATE JOB */

    if (
      req.method === "POST" &&
      req.url === "/api/jobs"
    ) {
      const body = await readBody(req);

      const title = clean(body.title);
      const location = clean(body.location);
      const salary = clean(body.salary);
      const category = clean(body.category);
      const description = clean(body.description);
      const phone = clean(body.phone);
      const pin = clean(body.pin);
      const image = clean(body.image);

      const user = userByPhone(phone);

      if (
        !title ||
        !location ||
        !salary ||
        !category ||
        !description ||
        !phone ||
        !pin
      ) {
        sendJSON(res, 400, {
          success: false,
          message: "সব তথ্য পূরণ করুন"
        });
        return;
      }

      if (!user || user.pinHash !== hashPIN(pin)) {
        sendJSON(res, 401, {
          success: false,
          message: "লগইন তথ্য সঠিক নয়"
        });
        return;
      }

      if (!imageValid(image, MAX_JOB_IMAGE)) {
        sendJSON(res, 400, {
          success: false,
          message: "কাজের ছবির সাইজ বা ফরম্যাট সঠিক নয়"
        });
        return;
      }

      const job = {
        id: id("job"),
        title,
        location,
        salary,
        category,
        description,
        phone,
        ownerName: user.name,
        ownerAvatar: user.avatar || "",
        image,
        createdAt: new Date().toISOString()
      };

      jobs.unshift(job);

      saveJSON(DB.jobs, jobs);

      /* JOB ALERT */

      alerts.forEach(alert => {
        if (
          alert.active &&
          locationMatch(location, alert.location) &&
          (
            !alert.category ||
            alert.category === "সব" ||
            normalize(alert.category) === normalize(category)
          )
        ) {
          notify(
            alert.phone,
            "job",
            "নতুন কাজ পাওয়া গেছে 🔔",
            `${title} — ${location}`,
            phone
          );
        }
      });

      sendJSON(res, 200, {
        success: true,
        message: "কাজ পোস্ট হয়েছে",
        job
      });

      return;
    }

    /* DELETE JOB */

    if (
      req.method === "POST" &&
      req.url === "/api/jobs/delete"
    ) {
      const body = await readBody(req);

      const job = jobs.find(
        j => j.id === clean(body.id)
      );

      const user = userByPhone(clean(body.phone));

      if (!job || !user) {
        sendJSON(res, 404, {
          success: false,
          message: "কাজ পাওয়া যায়নি"
        });
        return;
      }

      if (
        user.pinHash !== hashPIN(clean(body.pin)) ||
        job.phone !== user.phone
      ) {
        sendJSON(res, 403, {
          success: false,
          message: "অনুমতি নেই"
        });
        return;
      }

      jobs = jobs.filter(j => j.id !== job.id);

      applications = applications.filter(
        a => a.jobId !== job.id
      );

      saved = saved.filter(
        s => s.jobId !== job.id
      );

      saveJSON(DB.jobs, jobs);
      saveJSON(DB.applications, applications);
      saveJSON(DB.saved, saved);

      sendJSON(res, 200, {
        success: true,
        message: "কাজ মুছে ফেলা হয়েছে"
      });

      return;
    }

    /* MY JOBS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/my-jobs")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));

      const result = jobs
        .filter(j => j.phone === phone)
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

      sendJSON(res, 200, {
        success: true,
        jobs: result
      });

      return;
    }

    /* APPLY */

    if (
      req.method === "POST" &&
      req.url === "/api/apply"
    ) {
      const body = await readBody(req);

      const jobId = clean(body.jobId);
      const phone = clean(body.phone);
      const cv = clean(body.cv);
      const note = clean(body.note);

      const job = jobs.find(j => j.id === jobId);
      const applicant = userByPhone(phone);

      if (!job || !applicant) {
        sendJSON(res, 404, {
          success: false,
          message: "কাজ বা ব্যবহারকারী পাওয়া যায়নি"
        });
        return;
      }

      if (job.phone === phone) {
        sendJSON(res, 400, {
          success: false,
          message: "নিজের কাজে আবেদন করা যাবে না"
        });
        return;
      }

      const exists = applications.find(
        a =>
          a.jobId === jobId &&
          a.applicantPhone === phone
      );

      if (exists) {
        sendJSON(res, 409, {
          success: false,
          message: "আপনি আগে আবেদন করেছেন"
        });
        return;
      }

      const application = {
        id: id("application"),
        jobId,
        applicantPhone: phone,
        applicantName: applicant.name,
        applicantAvatar: applicant.avatar || "",
        employerPhone: job.phone,
        jobTitle: job.title,
        cv: cv || applicant.cv || "",
        note,
        status: "আবেদন করা হয়েছে",
        createdAt: new Date().toISOString()
      };

      applications.unshift(application);

      saveJSON(DB.applications, applications);

      notify(
        job.phone,
        "application",
        "নতুন আবেদন 📥",
        `${applicant.name} আপনার "${job.title}" কাজে আবেদন করেছেন`,
        phone
      );

      sendJSON(res, 200, {
        success: true,
        message: "আবেদন সফল হয়েছে",
        application
      });

      return;
    }

    /* APPLICATIONS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/applications")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));
      const mode = clean(url.searchParams.get("mode"));

      let result = [];

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
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

      sendJSON(res, 200, {
        success: true,
        applications: result
      });

      return;
    }

    /* APPLICATION STATUS */

    if (
      req.method === "POST" &&
      req.url === "/api/application/status"
    ) {
      const body = await readBody(req);

      const application = applications.find(
        a => a.id === clean(body.id)
      );

      if (!application) {
        sendJSON(res, 404, {
          success: false,
          message: "আবেদন পাওয়া যায়নি"
        });
        return;
      }

      const employer = userByPhone(clean(body.phone));

      if (
        !employer ||
        employer.phone !== application.employerPhone ||
        employer.pinHash !== hashPIN(clean(body.pin))
      ) {
        sendJSON(res, 403, {
          success: false,
          message: "অনুমতি নেই"
        });
        return;
      }

      application.status = clean(body.status);

      saveJSON(DB.applications, applications);

      notify(
        application.applicantPhone,
        "application",
        "আবেদনের আপডেট 📢",
        `${application.jobTitle}: ${application.status}`,
        employer.phone
      );

      sendJSON(res, 200, {
        success: true,
        message: "স্ট্যাটাস পরিবর্তন হয়েছে",
        application
      });

      return;
    }

    /* SAVE JOB */

    if (
      req.method === "POST" &&
      req.url === "/api/save"
    ) {
      const body = await readBody(req);

      const phone = clean(body.phone);
      const jobId = clean(body.jobId);

      const exists = saved.find(
        s => s.phone === phone && s.jobId === jobId
      );

      if (exists) {
        saved = saved.filter(
          s => !(s.phone === phone && s.jobId === jobId)
        );

        saveJSON(DB.saved, saved);

        sendJSON(res, 200, {
          success: true,
          saved: false,
          message: "Saved Jobs থেকে সরানো হয়েছে"
        });

        return;
      }

      saved.push({
        id: id("saved"),
        phone,
        jobId,
        createdAt: new Date().toISOString()
      });

      saveJSON(DB.saved, saved);

      sendJSON(res, 200, {
        success: true,
        saved: true,
        message: "কাজটি সংরক্ষণ করা হয়েছে"
      });

      return;
    }

    /* SAVED JOBS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/saved")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));

      const ids = saved
        .filter(s => s.phone === phone)
        .map(s => s.jobId);

      const result = jobs.filter(j =>
        ids.includes(j.id)
      );

      sendJSON(res, 200, {
        success: true,
        jobs: result
      });

      return;
    }

    /* RATING */

    if (
      req.method === "POST" &&
      req.url === "/api/rating"
    ) {
      const body = await readBody(req);

      const from = clean(body.from);
      const to = clean(body.to);
      const rating = Number(body.rating);
      const review = clean(body.review);

      if (
        !from ||
        !to ||
        rating < 1 ||
        rating > 5
      ) {
        sendJSON(res, 400, {
          success: false,
          message: "সঠিক rating দিন"
        });
        return;
      }

      const old = ratings.find(
        r => r.from === from && r.to === to
      );

      if (old) {
        old.rating = rating;
        old.review = review;
        old.createdAt = new Date().toISOString();
      } else {
        ratings.push({
          id: id("rating"),
          from,
          to,
          rating,
          review,
          createdAt: new Date().toISOString()
        });
      }

      saveJSON(DB.ratings, ratings);

      sendJSON(res, 200, {
        success: true,
        message: "Rating দেওয়া হয়েছে"
      });

      return;
    }

    /* JOB ALERT CREATE */

    if (
      req.method === "POST" &&
      req.url === "/api/alerts"
    ) {
      const body = await readBody(req);

      const phone = clean(body.phone);
      const location = clean(body.location);
      const category = clean(body.category);

      alerts = alerts.filter(
        a => a.phone !== phone
      );

      alerts.push({
        id: id("alert"),
        phone,
        location,
        category,
        active: true,
        createdAt: new Date().toISOString()
      });

      saveJSON(DB.alerts, alerts);

      sendJSON(res, 200, {
        success: true,
        message: "Job Alert চালু হয়েছে"
      });

      return;
    }

    /* ALERT GET */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/alerts")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));

      sendJSON(res, 200, {
        success: true,
        alert:
          alerts.find(a => a.phone === phone) || null
      });

      return;
    }

    /* INTERVIEW CREATE */

    if (
      req.method === "POST" &&
      req.url === "/api/interview"
    ) {
      const body = await readBody(req);

      const application = applications.find(
        a => a.id === clean(body.applicationId)
      );

      if (!application) {
        sendJSON(res, 404, {
          success: false,
          message: "আবেদন পাওয়া যায়নি"
        });
        return;
      }

      const employer = userByPhone(
        clean(body.phone)
      );

      if (
        !employer ||
        employer.phone !== application.employerPhone ||
        employer.pinHash !== hashPIN(clean(body.pin))
      ) {
        sendJSON(res, 403, {
          success: false,
          message: "অনুমতি নেই"
        });
        return;
      }

      const interview = {
        id: id("interview"),
        applicationId: application.id,
        employerPhone: application.employerPhone,
        applicantPhone: application.applicantPhone,
        date: clean(body.date),
        time: clean(body.time),
        place: clean(body.place),
        note: clean(body.note),
        createdAt: new Date().toISOString()
      };

      interviews.push(interview);

      saveJSON(DB.interviews, interviews);

      application.status = "সাক্ষাৎকার নির্ধারিত";

      saveJSON(DB.applications, applications);

      notify(
        application.applicantPhone,
        "interview",
        "Interview নির্ধারিত 📅",
        `${application.jobTitle} — ${interview.date} ${interview.time}`,
        employer.phone
      );

      sendJSON(res, 200, {
        success: true,
        message: "Interview নির্ধারণ করা হয়েছে",
        interview
      });

      return;
    }

    /* INTERVIEWS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/interviews")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));

      const result = interviews.filter(
        i =>
          i.applicantPhone === phone ||
          i.employerPhone === phone
      );

      sendJSON(res, 200, {
        success: true,
        interviews: result
      });

      return;
    }

    /* MESSAGES */

    if (
      req.method === "POST" &&
      req.url === "/api/messages/send"
    ) {
      const body = await readBody(req);

      const from = clean(body.from);
      const to = clean(body.to);
      const text = clean(body.text);

      if (!from || !to || !text) {
        sendJSON(res, 400, {
          success: false,
          message: "মেসেজ লিখুন"
        });
        return;
      }

      const sender = userByPhone(from);
      const receiver = userByPhone(to);

      if (!sender || !receiver) {
        sendJSON(res, 404, {
          success: false,
          message: "ব্যবহারকারী পাওয়া যায়নি"
        });
        return;
      }

      const message = {
        id: id("message"),
        from,
        to,
        text,
        createdAt: new Date().toISOString()
      };

      messages.push(message);

      if (messages.length > 20000) {
        messages = messages.slice(-20000);
      }

      saveJSON(DB.messages, messages);

      notify(
        to,
        "message",
        "নতুন মেসেজ 💬",
        `${sender.name} আপনাকে মেসেজ পাঠিয়েছে`,
        from
      );

      sendJSON(res, 200, {
        success: true,
        message
      });

      return;
    }

    /* MESSAGE LIST */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/messages")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const me = clean(url.searchParams.get("me"));
      const other = clean(url.searchParams.get("other"));

      const result = messages.filter(
        m =>
          (m.from === me && m.to === other) ||
          (m.from === other && m.to === me)
      );

      result.sort(
        (a, b) =>
          new Date(a.createdAt) -
          new Date(b.createdAt)
      );

      sendJSON(res, 200, {
        success: true,
        messages: result
      });

      return;
    }

    /* NOTIFICATIONS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/notifications")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const phone = clean(url.searchParams.get("phone"));

      const list = notifications
        .filter(n => n.phone === phone)
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

      sendJSON(res, 200, {
        success: true,
        unreadCount: list.filter(n => !n.read).length,
        notifications: list.slice(0, 100)
      });

      return;
    }

    /* NOTIFICATION READ */

    if (
      req.method === "POST" &&
      req.url === "/api/notifications/read"
    ) {
      const body = await readBody(req);
      const phone = clean(body.phone);

      notifications.forEach(n => {
        if (n.phone === phone) {
          n.read = true;
        }
      });

      saveJSON(DB.notifications, notifications);

      sendJSON(res, 200, {
        success: true
      });

      return;
    }

    /* SEARCH USERS */

    if (
      req.method === "GET" &&
      req.url.startsWith("/api/search")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const q = normalize(
        url.searchParams.get("q")
      );

      const result = users
        .filter(u => {
          const text = normalize(
            [
              u.name,
              u.phone,
              u.location,
              u.skills
            ].join(" ")
          );

          return text.includes(q);
        })
        .slice(0, 30)
        .map(publicUser);

      sendJSON(res, 200, {
        success: true,
        users: result
      });

      return;
    }

    sendJSON(res, 404, {
      success: false,
      message: "Not Found"
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    sendJSON(res, 500, {
      success: false,
      message:
        error.message === "REQUEST_TOO_LARGE"
          ? "ফাইল বা request অনেক বড়"
          : "Server error"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `কাজ খুঁজি server started on port ${PORT}`
  );

  console.log(
    "Future features enabled"
  );
});