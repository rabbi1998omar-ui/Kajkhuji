const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const DB_USERS = path.join(__dirname, "users.json");
const DB_JOBS = path.join(__dirname, "jobs.json");
const DB_MESSAGES = path.join(__dirname, "messages.json");


/* =========================================
   BASIC HELPERS
========================================= */

function loadJSON(file, fallback) {

  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(fallback, null, 2)
    );

    return fallback;
  }

  try {

    const data =
      fs.readFileSync(file, "utf8");

    return data
      ? JSON.parse(data)
      : fallback;

  } catch (error) {

    return fallback;

  }
}


function saveJSON(file, data) {

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );

}


function sendJSON(res, status, data) {

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  });

  res.end(
    JSON.stringify(data)
  );

}


function sendHTML(res, html) {

  res.writeHead(200, {
    "Content-Type":
      "text/html; charset=utf-8",

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

        resolve(
          body
            ? JSON.parse(body)
            : {}
        );

      } catch (error) {

        reject(error);

      }

    });

    req.on("error", reject);

  });

}


function createID() {

  return (
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2, 9)
  );

}


function hashPIN(pin) {

  return crypto
    .createHash("sha256")
    .update(String(pin))
    .digest("hex");

}


/* =========================================
   DATABASE
========================================= */

let users =
  loadJSON(DB_USERS, {});

let jobs =
  loadJSON(DB_JOBS, []);

let messages =
  loadJSON(DB_MESSAGES, []);


/* =========================================
   SERVER
========================================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        /* =================================
           CORS PREFLIGHT
        ================================= */

        if (req.method === "OPTIONS") {

          res.writeHead(204, {

            "Access-Control-Allow-Origin":
              "*",

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


        /* =================================
           HOME
        ================================= */

        if (
          req.method === "GET" &&
          pathname === "/"
        ) {

          const file =
            path.join(
              __dirname,
              "index.html"
            );


          if (!fs.existsSync(file)) {

            sendJSON(res, 404, {

              success: false,

              message:
                "index.html পাওয়া যায়নি।"

            });

            return;

          }


          const html =
            fs.readFileSync(
              file,
              "utf8"
            );


          sendHTML(res, html);

          return;

        }


        /* =================================
           HEALTH CHECK
        ================================= */

        if (
          req.method === "GET" &&
          pathname === "/health"
        ) {

          sendJSON(res, 200, {

            success: true,

            status: "online",

            app: "কাজ খুঁজি",

            users:
              Object.keys(users).length,

            jobs:
              jobs.length,

            messages:
              messages.length

          });

          return;

        }


        /* =================================
           REGISTER
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/register"
        ) {

          const body =
            await readBody(req);


          const name =
            String(
              body.name || ""
            ).trim();


          const phone =
            String(
              body.phone || ""
            ).trim();


          const location =
            String(
              body.location || ""
            ).trim();


          const pin =
            String(
              body.pin || ""
            ).trim();


          if (
            !name ||
            !phone ||
            !location ||
            !pin
          ) {

            sendJSON(res, 400, {

              success: false,

              message:
                "সব তথ্য পূরণ করুন।"

            });

            return;

          }


          if (pin.length < 4) {

            sendJSON(res, 400, {

              success: false,

              message:
                "PIN কমপক্ষে ৪ সংখ্যার হতে হবে।"

            });

            return;

          }


          if (users[phone]) {

            sendJSON(res, 409, {

              success: false,

              message:
                "এই ফোন নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট আছে।"

            });

            return;

          }


          const user = {

            id:
              createID(),

            phone,

            name,

            location,

            pinHash:
              hashPIN(pin),

            createdAt:
              new Date().toISOString()

          };


          users[phone] =
            user;


          saveJSON(
            DB_USERS,
            users
          );


          sendJSON(res, 201, {

            success: true,

            message:
              "অ্যাকাউন্ট তৈরি হয়েছে।",

            user: {

              id:
                user.id,

              phone:
                user.phone,

              name:
                user.name,

              location:
                user.location

            }

          });

          return;

        }


        /* =================================
           LOGIN
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/login"
        ) {

          const body =
            await readBody(req);


          const phone =
            String(
              body.phone || ""
            ).trim();


          const pin =
            String(
              body.pin || ""
            ).trim();


          if (!phone || !pin) {

            sendJSON(res, 400, {

              success: false,

              message:
                "ফোন ও PIN দিন।"

            });

            return;

          }


          const user =
            users[phone];


          if (!user) {

            sendJSON(res, 404, {

              success: false,

              message:
                "এই ফোন নম্বরে কোনো অ্যাকাউন্ট নেই।"

            });

            return;

          }


          if (
            user.pinHash !==
            hashPIN(pin)
          ) {

            sendJSON(res, 401, {

              success: false,

              message:
                "PIN সঠিক নয়।"

            });

            return;

          }


          sendJSON(res, 200, {

            success: true,

            message:
              "লগইন সফল হয়েছে।",

            user: {

              id:
                user.id,

              phone:
                user.phone,

              name:
                user.name,

              location:
                user.location

            }

          });

          return;

        }


        /* =================================
           PROFILE
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/profile"
        ) {

          const body =
            await readBody(req);


          const phone =
            String(
              body.phone || ""
            ).trim();


          const user =
            users[phone];


          if (!user) {

            sendJSON(res, 404, {

              success: false,

              message:
                "ব্যবহারকারী পাওয়া যায়নি।"

            });

            return;

          }


          if (body.name) {

            user.name =
              String(
                body.name
              ).trim();

          }


          if (body.location) {

            user.location =
              String(
                body.location
              ).trim();

          }


          saveJSON(
            DB_USERS,
            users
          );


          sendJSON(res, 200, {

            success: true,

            user: {

              id:
                user.id,

              phone:
                user.phone,

              name:
                user.name,

              location:
                user.location

            }

          });

          return;

        }


        /* =================================
           GET ALL JOBS
        ================================= */

        if (
          req.method === "GET" &&
          pathname === "/api/jobs"
        ) {

          const sortedJobs =
            [...jobs].sort(
              (a, b) =>
                new Date(b.createdAt) -
                new Date(a.createdAt)
            );


          sendJSON(res, 200, {

            success: true,

            jobs:
              sortedJobs

          });

          return;

        }


        /* =================================
           CREATE JOB
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/jobs"
        ) {

          const body =
            await readBody(req);


          const title =
            String(
              body.title || ""
            ).trim();


          const location =
            String(
              body.location || ""
            ).trim();


          const salary =
            String(
              body.salary || ""
            ).trim();


          const category =
            String(
              body.category || ""
            ).trim();


          const description =
            String(
              body.description || ""
            ).trim();


          const phone =
            String(
              body.phone || ""
            ).trim();


          const ownerName =
            String(
              body.ownerName || ""
            ).trim();


          if (
            !title ||
            !location ||
            !category ||
            !description ||
            !phone
          ) {

            sendJSON(res, 400, {

              success: false,

              message:
                "কাজের প্রয়োজনীয় তথ্য পূরণ করুন।"

            });

            return;

          }


          const job = {

            id:
              createID(),

            title,

            location,

            salary,

            category,

            description,

            phone,

            ownerName,

            createdAt:
              new Date().toISOString()

          };


          jobs.push(job);


          saveJSON(
            DB_JOBS,
            jobs
          );


          sendJSON(res, 201, {

            success: true,

            message:
              "কাজ পোস্ট হয়েছে।",

            job

          });

          return;

        }


        /* =================================
           MY JOBS
        ================================= */

        if (
          req.method === "GET" &&
          pathname === "/api/my-jobs"
        ) {

          const phone =
            String(
              url.searchParams.get(
                "phone"
              ) || ""
            ).trim();


          const myJobs =
            jobs.filter(
              job =>
                job.phone === phone
            );


          sendJSON(res, 200, {

            success: true,

            jobs:
              myJobs

          });

          return;

        }


        /* =================================
           DELETE JOB
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/jobs/delete"
        ) {

          const body =
            await readBody(req);


          const jobId =
            String(
              body.id || ""
            ).trim();


          const phone =
            String(
              body.phone || ""
            ).trim();


          const index =
            jobs.findIndex(
              job =>
                job.id === jobId &&
                job.phone === phone
            );


          if (index === -1) {

            sendJSON(res, 404, {

              success: false,

              message:
                "কাজ পাওয়া যায়নি।"

            });

            return;

          }


          jobs.splice(
            index,
            1
          );


          saveJSON(
            DB_JOBS,
            jobs
          );


          sendJSON(res, 200, {

            success: true,

            message:
              "কাজ মুছে ফেলা হয়েছে।"

          });

          return;

        }


        /* =================================
           SEND CHAT MESSAGE
        ================================= */

        if (
          req.method === "POST" &&
          pathname === "/api/messages/send"
        ) {

          const body =
            await readBody(req);


          const from =
            String(
              body.from || ""
            ).trim();


          const to =
            String(
              body.to || ""
            ).trim();


          const text =
            String(
              body.text || ""
            ).trim();


          if (
            !from ||
            !to ||
            !text
          ) {

            sendJSON(res, 400, {

              success: false,

              message:
                "বার্তা সম্পূর্ণ করুন।"

            });

            return;

          }


          if (!users[from]) {

            sendJSON(res, 401, {

              success: false,

              message:
                "প্রেরক ব্যবহারকারী পাওয়া যায়নি।"

            });

            return;

          }


          if (!users[to]) {

            sendJSON(res, 404, {

              success: false,

              message:
                "যাকে বার্তা পাঠাচ্ছেন তাকে পাওয়া যায়নি।"

            });

            return;

          }


          if (text.length > 2000) {

            sendJSON(res, 400, {

              success: false,

              message:
                "বার্তা সর্বোচ্চ ২০০০ অক্ষরের হতে পারে।"

            });

            return;

          }


          const message = {

            id:
              createID(),

            from,

            to,

            text,

            createdAt:
              new Date().toISOString()

          };


          messages.push(message);


          saveJSON(
            DB_MESSAGES,
            messages
          );


          sendJSON(res, 201, {

            success: true,

            message

          });

          return;

        }


        /* =================================
           GET CHAT MESSAGES
        ================================= */

        if (
          req.method === "GET" &&
          pathname === "/api/messages"
        ) {

          const me =
            String(
              url.searchParams.get(
                "me"
              ) || ""
            ).trim();


          const other =
            String(
              url.searchParams.get(
                "other"
              ) || ""
            ).trim();


          if (
            !me ||
            !other
          ) {

            sendJSON(res, 400, {

              success: false,

              message:
                "দুইজন ব্যবহারকারী নির্বাচন করুন।"

            });

            return;

          }


          const chat =
            messages.filter(
              message =>

                (
                  message.from === me &&
                  message.to === other
                )

                ||

                (
                  message.from === other &&
                  message.to === me
                )

            );


          sendJSON(res, 200, {

            success: true,

            messages:
              chat

          });

          return;

        }


        /* =================================
           404
        ================================= */

        sendJSON(res, 404, {

          success: false,

          message:
            "Not Found"

        });

      } catch (error) {

        console.error(
          "SERVER ERROR:",
          error
        );


        sendJSON(res, 500, {

          success: false,

          message:
            "Server error হয়েছে।"

        });

      }

    }
  );


/* =========================================
   START SERVER
========================================= */

server.listen(
  PORT,
  () => {

    console.log(
      `কাজ খুঁজি server started on port ${PORT}`
    );

  }
);