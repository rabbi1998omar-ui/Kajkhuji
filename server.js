const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const USERS_FILE = path.join(__dirname, "users.json");
const JOBS_FILE = path.join(__dirname, "jobs.json");

let users = {};
let jobs = [];


/* =========================================
   DATABASE LOAD
========================================= */

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8");

    if (!data.trim()) return fallback;

    return JSON.parse(data);

  } catch (error) {
    console.log("Database load error:", error.message);
    return fallback;
  }
}

users = loadJSON(USERS_FILE, {});
jobs = loadJSON(JOBS_FILE, []);


/* =========================================
   DATABASE SAVE
========================================= */

function saveUsers() {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2)
  );
}

function saveJobs() {
  fs.writeFileSync(
    JOBS_FILE,
    JSON.stringify(jobs, null, 2)
  );
}


/* =========================================
   PASSWORD HASH
========================================= */

function hashPIN(pin) {
  return crypto
    .createHash("sha256")
    .update(String(pin))
    .digest("hex");
}


/* =========================================
   ID
========================================= */

function createID() {
  return (
    Date.now().toString(36) +
    crypto.randomBytes(5).toString("hex")
  );
}


/* =========================================
   JSON RESPONSE
========================================= */

function json(res, status, data) {

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type"
  });

  res.end(JSON.stringify(data));
}


/* =========================================
   READ REQUEST BODY
========================================= */

function readBody(req) {

  return new Promise((resolve, reject) => {

    let body = "";

    req.on("data", chunk => {

      body += chunk;

      if (body.length > 1024 * 1024) {
        req.destroy();

        reject(
          new Error("Request body too large")
        );
      }

    });

    req.on("end", () => {

      try {

        resolve(
          body ? JSON.parse(body) : {}
        );

      } catch (error) {

        reject(
          new Error("Invalid JSON")
        );

      }

    });

    req.on("error", reject);

  });

}


/* =========================================
   SERVE FILE
========================================= */

function serveFile(res, fileName) {

  const filePath =
    path.join(__dirname, fileName);

  if (!fs.existsSync(filePath)) {

    res.writeHead(404, {
      "Content-Type": "text/plain"
    });

    res.end("File Not Found");

    return;
  }

  const ext =
    path.extname(filePath).toLowerCase();

  const types = {

    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".svg":
      "image/svg+xml",

    ".ico":
      "image/x-icon"

  };

  res.writeHead(200, {
    "Content-Type":
      types[ext] ||
      "application/octet-stream"
  });

  fs.createReadStream(filePath)
    .pipe(res);
}


/* =========================================
   SERVER
========================================= */

const server = http.createServer(
  async (req, res) => {

    try {

      /* OPTIONS */

      if (req.method === "OPTIONS") {

        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type"
        });

        res.end();

        return;
      }


      const url =
        new URL(
          req.url,
          `http://${req.headers.host}`
        );

      const pathname =
        url.pathname;


      /* =====================================
         HOME
      ===================================== */

      if (
        req.method === "GET" &&
        pathname === "/"
      ) {

        serveFile(
          res,
          "index.html"
        );

        return;
      }


      /* =====================================
         HEALTH
      ===================================== */

      if (
        req.method === "GET" &&
        pathname === "/health"
      ) {

        json(res, 200, {
          success: true,
          app: "কাজ খুঁজি",
          status: "online",
          time: new Date().toISOString()
        });

        return;
      }


      /* =====================================
         REGISTER
      ===================================== */

      if (
        req.method === "POST" &&
        pathname === "/api/register"
      ) {

        const body =
          await readBody(req);

        const phone =
          String(body.phone || "").trim();

        const pin =
          String(body.pin || "").trim();

        const name =
          String(body.name || "").trim();

        const location =
          String(body.location || "").trim();


        if (!phone || !pin || !name) {

          json(res, 400, {
            success: false,
            message:
              "নাম, ফোন ও PIN প্রয়োজন।"
          });

          return;
        }


        if (pin.length < 4) {

          json(res, 400, {
            success: false,
            message:
              "PIN কমপক্ষে ৪ সংখ্যার হতে হবে।"
          });

          return;
        }


        if (users[phone]) {

          json(res, 409, {
            success: false,
            message:
              "এই ফোন নম্বর দিয়ে ইতিমধ্যে অ্যাকাউন্ট আছে।"
          });

          return;
        }


        users[phone] = {

          id: createID(),

          phone,

          name,

          location,

          pinHash: hashPIN(pin),

          createdAt:
            new Date().toISOString()

        };


        saveUsers();


        json(res, 201, {

          success: true,

          message:
            "অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।",

          user: {

            id: users[phone].id,

            phone,

            name,

            location

          }

        });

        return;
      }


      /* =====================================
         LOGIN
      ===================================== */

      if (
        req.method === "POST" &&
        pathname === "/api/login"
      ) {

        const body =
          await readBody(req);

        const phone =
          String(body.phone || "").trim();

        const pin =
          String(body.pin || "").trim();


        if (!phone || !pin) {

          json(res, 400, {
            success: false,
            message:
              "ফোন ও PIN দিন।"
          });

          return;
        }


        const user =
          users[phone];


        if (!user) {

          json(res, 404, {
            success: false,
            message:
              "এই ফোন নম্বরের কোনো অ্যাকাউন্ট পাওয়া যায়নি।"
          });

          return;
        }


        if (
          user.pinHash !==
          hashPIN(pin)
        ) {

          json(res, 401, {
            success: false,
            message:
              "PIN সঠিক নয়।"
          });

          return;
        }


        json(res, 200, {

          success: true,

          message:
            "লগইন সফল হয়েছে।",

          user: {

            id: user.id,

            phone: user.phone,

            name: user.name,

            location:
              user.location || ""

          }

        });

        return;
      }


      /* =====================================
         PROFILE
      ===================================== */

      if (
        req.method === "POST" &&
        pathname === "/api/profile"
      ) {

        const body =
          await readBody(req);

        const phone =
          String(body.phone || "").trim();

        const user =
          users[phone];


        if (!user) {

          json(res, 404, {
            success: false,
            message:
              "ব্যবহারকারী পাওয়া যায়নি।"
          });

          return;
        }


        if (body.name !== undefined) {
          user.name =
            String(body.name).trim();
        }

        if (body.location !== undefined) {
          user.location =
            String(body.location).trim();
        }


        saveUsers();


        json(res, 200, {

          success: true,

          user: {

            id: user.id,

            phone: user.phone,

            name: user.name,

            location:
              user.location || ""

          }

        });

        return;
      }


      /* =====================================
         GET JOBS
      ===================================== */

      if (
        req.method === "GET" &&
        pathname === "/api/jobs"
      ) {

        const search =
          String(
            url.searchParams.get("search") || ""
          )
          .toLowerCase()
          .trim();

        const category =
          String(
            url.searchParams.get("category") || ""
          )
          .trim();


        let result =
          [...jobs].reverse();


        if (search) {

          result =
            result.filter(job => {

              const text = (

                job.title +
                " " +
                job.location +
                " " +
                job.category +
                " " +
                job.description

              ).toLowerCase();

              return text.includes(search);

            });

        }


        if (category) {

          result =
            result.filter(
              job =>
                job.category === category
            );

        }


        json(res, 200, {

          success: true,

          jobs: result

        });

        return;
      }


      /* =====================================
         CREATE JOB
      ===================================== */

      if (
        req.method === "POST" &&
        pathname === "/api/jobs"
      ) {

        const body =
          await readBody(req);


        const phone =
          String(body.phone || "").trim();

        const title =
          String(body.title || "").trim();

        const location =
          String(body.location || "").trim();

        const salary =
          String(body.salary || "").trim();

        const category =
          String(body.category || "").trim();

        const description =
          String(
            body.description || ""
          ).trim();


        if (!phone || !title ||
            !location || !salary ||
            !category) {

          json(res, 400, {

            success: false,

            message:
              "প্রয়োজনীয় সব তথ্য পূরণ করুন।"

          });

          return;
        }


        if (!users[phone]) {

          json(res, 401, {

            success: false,

            message:
              "আগে লগইন করুন।"

          });

          return;
        }


        const job = {

          id: createID(),

          title,

          location,

          salary,

          category,

          description,

          phone,

          ownerName:
            users[phone].name,

          createdAt:
            new Date().toISOString()

        };


        jobs.push(job);

        saveJobs();


        json(res, 201, {

          success: true,

          message:
            "কাজ সফলভাবে পোস্ট হয়েছে।",

          job

        });

        return;
      }


      /* =====================================
         DELETE JOB
      ===================================== */

      if (
        req.method === "POST" &&
        pathname === "/api/jobs/delete"
      ) {

        const body =
          await readBody(req);

        const phone =
          String(body.phone || "").trim();

        const jobId =
          String(body.jobId || "").trim();


        const index =
          jobs.findIndex(
            job =>
              job.id === jobId &&
              job.phone === phone
          );


        if (index === -1) {

          json(res, 404, {

            success: false,

            message:
              "কাজটি পাওয়া যায়নি।"

          });

          return;
        }


        jobs.splice(index, 1);

        saveJobs();


        json(res, 200, {

          success: true,

          message:
            "কাজ মুছে ফেলা হয়েছে।"

        });

        return;
      }


      /* =====================================
         MY JOBS
      ===================================== */

      if (
        req.method === "GET" &&
        pathname === "/api/my-jobs"
      ) {

        const phone =
          String(
            url.searchParams.get("phone") || ""
          ).trim();


        if (!phone) {

          json(res, 400, {

            success: false,

            message:
              "ফোন নম্বর প্রয়োজন।"

          });

          return;
        }


        const result =
          jobs.filter(
            job =>
              job.phone === phone
          );


        json(res, 200, {

          success: true,

          jobs: result.reverse()

        });

        return;
      }


      /* =====================================
         404
      ===================================== */

      json(res, 404, {

        success: false,

        message:
          "API endpoint পাওয়া যায়নি।",

        path: pathname

      });


    } catch (error) {

      console.error(
        "Server error:",
        error
      );


      json(res, 500, {

        success: false,

        message:
          "সার্ভারে সমস্যা হয়েছে।"

      });

    }

  }
);


/* =========================================
   START SERVER
========================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `কাজ খুঁজি server started on port ${PORT}`
    );

  }
);


/* =========================================
   ERROR HANDLING
========================================= */

process.on(
  "uncaughtException",
  error => {

    console.error(
      "Uncaught Exception:",
      error
    );

  }
);

process.on(
  "unhandledRejection",
  error => {

    console.error(
      "Unhandled Rejection:",
      error
    );

  }
);