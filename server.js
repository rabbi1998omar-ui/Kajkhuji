const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const DB_USERS = path.join(__dirname, "users.json");
const DB_JOBS = path.join(__dirname, "jobs.json");
const DB_MESSAGES = path.join(__dirname, "messages.json");
const DB_NOTIFICATIONS = path.join(__dirname, "notifications.json");


/* =========================================
   DATABASE HELPERS
========================================= */

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8");

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);
  } catch (error) {
    console.error("Database read error:", file, error.message);
    return fallback;
  }
}


function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    return true;
  } catch (error) {
    console.error("Database save error:", file, error.message);
    return false;
  }
}


/* =========================================
   LOAD DATABASE
========================================= */

let users = loadJSON(DB_USERS, {});
let jobs = loadJSON(DB_JOBS, []);
let messages = loadJSON(DB_MESSAGES, []);
let notifications = loadJSON(DB_NOTIFICATIONS, []);


/* =========================================
   RESPONSE HELPERS
========================================= */

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end(JSON.stringify(data));
}


function sendHTML(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(html);
}


function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}


/* =========================================
   HELPERS
========================================= */

function createID(prefix = "id") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
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


function clean(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}


function getUserByPhone(phone) {
  if (!phone) return null;

  return users[phone] || null;
}


/* =========================================
   NOTIFICATION HELPER
========================================= */

function createNotification({
  phone,
  type = "general",
  title = "",
  text = "",
  from = ""
}) {
  if (!phone) return null;

  const notification = {
    id: createID("notification"),
    phone: phone,
    type: type,
    title: clean(title, 150),
    text: clean(text, 500),
    from: clean(from, 100),
    read: false,
    createdAt: new Date().toISOString()
  };

  notifications.unshift(notification);

  // Keep database from becoming unnecessarily huge
  if (notifications.length > 5000) {
    notifications = notifications.slice(0, 5000);
  }

  saveJSON(DB_NOTIFICATIONS, notifications);

  return notification;
}


/* =========================================
   SERVER
========================================= */

const server = http.createServer(async (req, res) => {

  /* =======================================
     CORS PREFLIGHT
  ======================================= */

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    return res.end();
  }


  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  const pathname = url.pathname;


  /* =======================================
     HOME
  ======================================= */

  if (req.method === "GET" && pathname === "/") {
    try {
      const html = fs.readFileSync(
        path.join(__dirname, "index.html"),
        "utf8"
      );

      return sendHTML(res, 200, html);
    } catch (error) {
      return sendJSON(res, 500, {
        success: false,
        message: "index.html পাওয়া যায়নি"
      });
    }
  }


  /* =======================================
     HEALTH CHECK
  ======================================= */

  if (req.method === "GET" && pathname === "/health") {
    return sendJSON(res, 200, {
      success: true,
      app: "কাজ খুঁজি",
      status: "online",
      time: new Date().toISOString()
    });
  }


  /* =======================================
     REGISTER
  ======================================= */

  if (req.method === "POST" && pathname === "/api/register") {

    try {
      const body = await readBody(req);

      const name = clean(body.name, 100);
      const phone = clean(body.phone, 30);
      const location = clean(body.location, 150);
      const pin = String(body.pin || "");

      if (!name || !phone || !location || !pin) {
        return sendJSON(res, 400, {
          success: false,
          message: "সব তথ্য পূরণ করুন"
        });
      }

      if (pin.length < 4 || pin.length > 20) {
        return sendJSON(res, 400, {
          success: false,
          message: "PIN ৪ থেকে ২০ সংখ্যার মধ্যে দিন"
        });
      }

      if (users[phone]) {
        return sendJSON(res, 409, {
          success: false,
          message: "এই মোবাইল নম্বরে ইতিমধ্যে অ্যাকাউন্ট আছে"
        });
      }

      users[phone] = {
        id: createID("user"),
        phone: phone,
        name: name,
        location: location,
        pinHash: hashPIN(pin),
        createdAt: new Date().toISOString()
      };

      saveJSON(DB_USERS, users);

      return sendJSON(res, 201, {
        success: true,
        message: "অ্যাকাউন্ট তৈরি হয়েছে",
        user: {
          phone: phone,
          name: name,
          location: location
        }
      });

    } catch (error) {
      return sendJSON(res, 400, {
        success: false,
        message: "ভুল তথ্য পাঠানো হয়েছে"
      });
    }
  }


  /* =======================================
     LOGIN
  ======================================= */

  if (req.method === "POST" && pathname === "/api/login") {

    try {
      const body = await readBody(req);

      const phone = clean(body.phone, 30);
      const pin = String(body.pin || "");

      const user = users[phone];

      if (!user) {
        return sendJSON(res, 401, {
          success: false,
          message: "অ্যাকাউন্ট পাওয়া যায়নি"
        });
      }

      if (user.pinHash !== hashPIN(pin)) {
        return sendJSON(res, 401, {
          success: false,
          message: "PIN সঠিক নয়"
        });
      }

      return sendJSON(res, 200, {
        success: true,
        message: "লগইন সফল",
        user: {
          phone: user.phone,
          name: user.name,
          location: user.location
        }
      });

    } catch (error) {
      return sendJSON(res, 400, {
        success: false,
        message: "লগইন তথ্য সঠিক নয়"
      });
    }
  }


  /* =======================================
     PROFILE
  ======================================= */

  if (req.method === "POST" && pathname === "/api/profile") {

    try {
      const body = await readBody(req);

      const phone = clean(body.phone, 30);
      const pin = String(body.pin || "");

      const user = users[phone];

      if (!user) {
        return sendJSON(res, 404, {
          success: false,
          message: "ব্যবহারকারী পাওয়া যায়নি"
        });
      }

      if (user.pinHash !== hashPIN(pin)) {
        return sendJSON(res, 401, {
          success: false,
          message: "PIN সঠিক নয়"
        });
      }

      return sendJSON(res, 200, {
        success: true,
        user: {
          phone: user.phone,
          name: user.name,
          location: user.location
        }
      });

    } catch (error) {
      return sendJSON(res, 400, {
        success: false,
        message: "ভুল তথ্য"
      });
    }
  }


  /* =======================================
     GET JOBS
  ======================================= */

  if (req.method === "GET" && pathname === "/api/jobs") {

    return sendJSON(res, 200, {
      success: true,
      jobs: jobs
    });
  }


  /* =======================================
     CREATE JOB
  ======================================= */

  if (req.method === "POST" && pathname === "/api/jobs") {

    try {
      const body = await readBody(req);

      const phone = clean(body.phone, 30);
      const pin = String(body.pin || "");

      const user = users[phone];

      if (!user) {
        return sendJSON(res, 401, {
          success: false,
          message: "লগইন করুন"
        });
      }

      if (user.pinHash !== hashPIN(pin)) {
        return sendJSON(res, 401, {
          success: false,
          message: "PIN সঠিক নয়"
        });
      }

      const title = clean(body.title, 150);
      const location = clean(body.location, 150);
      const salary = clean(body.salary, 100);
      const category = clean(body.category, 100);
      const description = clean(body.description, 1000);

      if (
        !title ||
        !location ||
        !salary ||
        !category ||
        !description
      ) {
        return sendJSON(res, 400, {
          success: false,
          message: "সব তথ্য পূরণ করুন"
        });
      }

      const job = {
        id: createID("job"),
        title: title,
        location: location,
        salary: salary,
        category: category,
        description: description,
        phone: phone,
        ownerName: user.name,
        createdAt: new Date().toISOString()
      };

      jobs.unshift(job);

      saveJSON(DB_JOBS, jobs);

      /*
        নতুন Job তৈরি হলে অন্য ব্যবহারকারীদের
        notification দেওয়া হচ্ছে না,
        কারণ এখনো user-specific job matching
        system তৈরি হয়নি।
      */

      return sendJSON(res, 201, {
        success: true,
        message: "কাজ সফলভাবে পোস্ট হয়েছে",
        job: job
      });

    } catch (error) {
      console.error(error);

      return sendJSON(res, 400, {
        success: false,
        message: "কাজ পোস্ট করা যায়নি"
      });
    }
  }


  /* =======================================
     MY JOBS
  ======================================= */

  if (req.method === "GET" && pathname === "/api/my-jobs") {

    const phone = clean(
      url.searchParams.get("phone"),
      30
    );

    const myJobs = jobs.filter(
      job => job.phone === phone
    );

    return sendJSON(res, 200, {
      success: true,
      jobs: myJobs
    });
  }


  /* =======================================
     DELETE JOB
  ======================================= */

  if (
    req.method === "POST" &&
    pathname === "/api/jobs/delete"
  ) {

    try {
      const body = await readBody(req);

      const phone = clean(body.phone, 30);
      const pin = String(body.pin || "");
      const jobId = clean(body.jobId, 100);

      const user = users[phone];

      if (!user) {
        return sendJSON(res, 401, {
          success: false,
          message: "লগইন করুন"
        });
      }

      if (user.pinHash !== hashPIN(pin)) {
        return sendJSON(res, 401, {
          success: false,
          message: "PIN সঠিক নয়"
        });
      }

      const job = jobs.find(
        item => item.id === jobId
      );

      if (!job) {
        return sendJSON(res, 404, {
          success: false,
          message: "কাজ পাওয়া যায়নি"
        });
      }

      if (job.phone !== phone) {
        return sendJSON(res, 403, {
          success: false,
          message: "এই কাজটি আপনার নয়"
        });
      }

      jobs = jobs.filter(
        item => item.id !== jobId
      );

      saveJSON(DB_JOBS, jobs);

      return sendJSON(res, 200, {
        success: true,
        message: "কাজ মুছে ফেলা হয়েছে"
      });

    } catch (error) {
      return sendJSON(res, 400, {
        success: false,
        message: "কাজ মুছতে সমস্যা হয়েছে"
      });
    }
  }


  /* =======================================
     SEND CHAT MESSAGE
  ======================================= */

  if (
    req.method === "POST" &&
    pathname === "/api/messages/send"
  ) {

    try {
      const body = await readBody(req);

      const from = clean(body.from, 30);
      const to = clean(body.to, 30);
      const text = clean(body.text, 2000);

      if (!from || !to || !text) {
        return sendJSON(res, 400, {
          success: false,
          message: "বার্তা লিখুন"
        });
      }

      if (!users[from]) {
        return sendJSON(res, 401, {
          success: false,
          message: "প্রেরক ব্যবহারকারী পাওয়া যায়নি"
        });
      }

      if (!users[to]) {
        return sendJSON(res, 404, {
          success: false,
          message: "প্রাপক ব্যবহারকারী পাওয়া যায়নি"
        });
      }

      const message = {
        id: createID("message"),
        from: from,
        to: to,
        text: text,
        createdAt: new Date().toISOString()
      };

      messages.push(message);

      if (messages.length > 10000) {
        messages = messages.slice(-10000);
      }

      saveJSON(DB_MESSAGES, messages);


      /* =====================================
         CHAT NOTIFICATION
      ===================================== */

      const sender = users[from];

      createNotification({
        phone: to,
        type: "message",
        title: "নতুন মেসেজ 💬",
        text: `${sender ? sender.name : "কেউ"} আপনাকে একটি মেসেজ পাঠিয়েছে`,
        from: from
      });


      return sendJSON(res, 201, {
        success: true,
        message: message
      });

    } catch (error) {
      console.error(error);

      return sendJSON(res, 400, {
        success: false,
        message: "মেসেজ পাঠানো যায়নি"
      });
    }
  }


  /* =======================================
     GET CHAT MESSAGES
  ======================================= */

  if (
    req.method === "GET" &&
    pathname === "/api/messages"
  ) {

    const me = clean(
      url.searchParams.get("me"),
      30
    );

    const other = clean(
      url.searchParams.get("other"),
      30
    );

    if (!me || !other) {
      return sendJSON(res, 400, {
        success: false,
        message: "ব্যবহারকারী তথ্য প্রয়োজন"
      });
    }

    const chat = messages.filter(message => {
      return (
        (message.from === me &&
          message.to === other) ||
        (message.from === other &&
          message.to === me)
      );
    });

    chat.sort(
      (a, b) =>
        new Date(a.createdAt) -
        new Date(b.createdAt)
    );

    return sendJSON(res, 200, {
      success: true,
      messages: chat
    });
  }


  /* =======================================
     GET NOTIFICATIONS
  ======================================= */

  if (
    req.method === "GET" &&
    pathname === "/api/notifications"
  ) {

    const phone = clean(
      url.searchParams.get("phone"),
      30
    );

    if (!phone) {
      return sendJSON(res, 400, {
        success: false,
        message: "ফোন নম্বর প্রয়োজন"
      });
    }

    const userNotifications = notifications
      .filter(item => item.phone === phone)
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    const unreadCount =
      userNotifications.filter(
        item => !item.read
      ).length;

    return sendJSON(res, 200, {
      success: true,
      notifications: userNotifications,
      unreadCount: unreadCount
    });
  }


  /* =======================================
     MARK NOTIFICATION AS READ
  ======================================= */

  if (
    req.method === "POST" &&
    pathname === "/api/notifications/read"
  ) {

    try {
      const body = await readBody(req);

      const phone = clean(body.phone, 30);

      if (!phone) {
        return sendJSON(res, 400, {
          success: false,
          message: "ফোন নম্বর প্রয়োজন"
        });
      }

      let changed = false;

      notifications = notifications.map(item => {

        if (
          item.phone === phone &&
          !item.read
        ) {
          changed = true;

          return {
            ...item,
            read: true,
            readAt: new Date().toISOString()
          };
        }

        return item;
      });

      if (changed) {
        saveJSON(
          DB_NOTIFICATIONS,
          notifications
        );
      }

      return sendJSON(res, 200, {
        success: true,
        message: "Notification read হয়েছে"
      });

    } catch (error) {
      return sendJSON(res, 400, {
        success: false,
        message: "Notification update করা যায়নি"
      });
    }
  }


  /* =======================================
     404
  ======================================= */

  return sendJSON(res, 404, {
    success: false,
    message: "Not Found"
  });
});


/* =========================================
   SERVER ERROR
========================================= */

server.on("error", error => {
  console.error("Server error:", error);
});


/* =========================================
   START
========================================= */

server.listen(PORT, () => {
  console.log(
    `কাজ খুঁজি server started on port ${PORT}`
  );
});