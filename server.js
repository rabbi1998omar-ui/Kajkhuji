const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;

const DB = {
  users: path.join(__dirname, "users.json"),
  jobs: path.join(__dirname, "jobs.json"),
  messages: path.join(__dirname, "messages.json"),
  notifications: path.join(__dirname, "notifications.json")
};

const MAX_AVATAR_BYTES = 350 * 1024;
const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

/* =========================================
   DATABASE
========================================= */

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(fallback, null, 2)
      );
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8");

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);

  } catch (error) {
    console.error("Database read error:", error);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );

    return true;

  } catch (error) {
    console.error("Database save error:", error);
    return false;
  }
}

let users = loadJSON(DB.users, []);
let jobs = loadJSON(DB.jobs, []);
let messages = loadJSON(DB.messages, []);
let notifications = loadJSON(DB.notifications, []);


/* =========================================
   HELPERS
========================================= */

function sendJSON(res, status, data) {

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS"
  });

  res.end(JSON.stringify(data));
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

      /*
       * Prevent extremely large requests.
       * 1 MB maximum request body.
       */

      if (Buffer.byteLength(body, "utf8") > 1024 * 1024) {

        reject(
          new Error("Request body too large")
        );

        req.destroy();

      }

    });

    req.on("end", () => {

      if (!body) {

        resolve({});

        return;
      }

      try {

        resolve(JSON.parse(body));

      } catch (error) {

        reject(error);

      }

    });

    req.on("error", reject);

  });

}


function createID(prefix = "id") {

  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto
      .randomBytes(5)
      .toString("hex")
  );

}


function hashPIN(pin) {

  return crypto
    .createHash("sha256")
    .update(String(pin))
    .digest("hex");

}


function clean(value) {

  return String(value || "").trim();

}


function normalize(value) {

  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

}


function getUserByPhone(phone) {

  return users.find(
    user =>
      user.phone === clean(phone)
  );

}


function validPIN(pin) {

  return /^\d{6}$/.test(
    clean(pin)
  );

}


/* =========================================
   PROFILE IMAGE
========================================= */

function normalizeAvatar(value) {

  if (!value) {
    return "";
  }

  const avatar = String(value).trim();

  if (!avatar) {
    return "";
  }

  const match = avatar.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {

    return "";

  }

  const mime = match[1];
  const base64 = match[2];

  if (
    !ALLOWED_AVATAR_TYPES.includes(mime)
  ) {

    return "";

  }

  let bytes = 0;

  try {

    bytes = Buffer.byteLength(
      base64,
      "base64"
    );

  } catch (error) {

    return "";

  }

  if (bytes > MAX_AVATAR_BYTES) {

    return "";

  }

  return `data:${mime};base64,${base64}`;

}


/* =========================================
   PUBLIC USER
========================================= */

function publicUser(user) {

  return {

    id: user.id,

    phone: user.phone,

    name: user.name,

    location: user.location,

    avatar: user.avatar || ""

  };

}


/* =========================================
   LOCATION MATCH
========================================= */

function locationMatch(
  jobLocation,
  searchLocation
) {

  const job =
    normalize(jobLocation);

  const search =
    normalize(searchLocation);

  if (!search) {
    return true;
  }

  if (!job) {
    return false;
  }

  if (job.includes(search)) {
    return true;
  }

  if (search.includes(job)) {
    return true;
  }

  const jobWords =
    job
      .split(/[,\s]+/)
      .filter(Boolean);

  const searchWords =
    search
      .split(/[,\s]+/)
      .filter(Boolean);

  return searchWords.some(
    word =>
      word.length >= 2 &&
      jobWords.includes(word)
  );

}


/* =========================================
   NOTIFICATION
========================================= */

function createNotification({
  phone,
  type,
  title,
  text,
  from = ""
}) {

  notifications.unshift({

    id: createID(
      "notification"
    ),

    phone: clean(phone),

    type: clean(type),

    title: clean(title),

    text: clean(text),

    from: clean(from),

    read: false,

    createdAt:
      new Date().toISOString()

  });

  if (
    notifications.length >
    5000
  ) {

    notifications =
      notifications.slice(0, 5000);

  }

  saveJSON(
    DB.notifications,
    notifications
  );

}


/* =========================================
   SERVER
========================================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        /* =================================
           OPTIONS
        ================================= */

        if (
          req.method === "OPTIONS"
        ) {

          res.writeHead(204, {

            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type",

            "Access-Control-Allow-Methods":
              "GET,POST,OPTIONS"

          });

          res.end();

          return;
        }


        /* =================================
           HOME
        ================================= */

        if (
          req.method === "GET" &&
          req.url === "/"
        ) {

          const indexFile =
            path.join(
              __dirname,
              "index.html"
            );

          if (
            fs.existsSync(indexFile)
          ) {

            const html =
              fs.readFileSync(
                indexFile,
                "utf8"
              );

            sendHTML(
              res,
              html
            );

          } else {

            sendHTML(
              res,
              "<h1>💼 কাজ খুঁজি</h1>"
            );

          }

          return;
        }


        /* =================================
           HEALTH
        ================================= */

        if (
          req.method === "GET" &&
          req.url === "/health"
        ) {

          sendJSON(
            res,
            200,
            {

              success: true,

              status: "ok",

              app: "কাজ খুঁজি",

              users:
                users.length,

              jobs:
                jobs.length,

              messages:
                messages.length,

              notifications:
                notifications.length,

              time:
                new Date().toISOString()

            }
          );

          return;
        }


        /* =================================
           REGISTER
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/register"
        ) {

          const body =
            await readBody(req);

          const name =
            clean(body.name);

          const phone =
            clean(body.phone);

          const location =
            clean(body.location);

          const pin =
            clean(body.pin);

          const avatar =
            normalizeAvatar(
              body.avatar
            );


          if (
            !name ||
            !phone ||
            !location ||
            !pin
          ) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "সব তথ্য পূরণ করুন"
              }
            );

            return;
          }


          if (!validPIN(pin)) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
              }
            );

            return;
          }


          const existing =
            getUserByPhone(phone);


          if (existing) {

            sendJSON(
              res,
              409,
              {
                success: false,
                message:
                  "এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট আছে"
              }
            );

            return;
          }


          const user = {

            id:
              createID("user"),

            phone,

            name,

            location,

            avatar,

            pinHash:
              hashPIN(pin),

            createdAt:
              new Date().toISOString()

          };


          users.push(user);


          if (
            !saveJSON(
              DB.users,
              users
            )
          ) {

            sendJSON(
              res,
              500,
              {
                success: false,
                message:
                  "অ্যাকাউন্ট সংরক্ষণ করা যায়নি"
              }
            );

            return;
          }


          sendJSON(
            res,
            200,
            {
              success: true,

              message:
                "অ্যাকাউন্ট তৈরি হয়েছে",

              user:
                publicUser(user)

            }
          );

          return;
        }


        /* =================================
           LOGIN
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/login"
        ) {

          const body =
            await readBody(req);

          const phone =
            clean(body.phone);

          const pin =
            clean(body.pin);


          if (
            !phone ||
            !pin
          ) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "মোবাইল নম্বর ও PIN দিন"
              }
            );

            return;
          }


          if (!validPIN(pin)) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
              }
            );

            return;
          }


          const user =
            getUserByPhone(phone);


          if (!user) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি"
              }
            );

            return;
          }


          if (
            user.pinHash !==
            hashPIN(pin)
          ) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ভুল PIN"
              }
            );

            return;
          }


          sendJSON(
            res,
            200,
            {

              success: true,

              message:
                "লগইন সফল",

              user:
                publicUser(user)

            }
          );

          return;
        }


        /* =================================
           GET PROFILE
        ================================= */

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/api/profile"
          )
        ) {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );

          const phone =
            clean(
              url.searchParams.get(
                "phone"
              )
            );


          const user =
            getUserByPhone(phone);


          if (!user) {

            sendJSON(
              res,
              404,
              {
                success: false,
                message:
                  "ব্যবহারকারী পাওয়া যায়নি"
              }
            );

            return;
          }


          sendJSON(
            res,
            200,
            {

              success: true,

              user:
                publicUser(user),

              jobCount:
                jobs.filter(
                  job =>
                    job.phone === phone
                ).length

            }
          );

          return;
        }


        /* =================================
           UPDATE PROFILE
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/profile"
        ) {

          const body =
            await readBody(req);

          const phone =
            clean(body.phone);

          const name =
            clean(body.name);

          const location =
            clean(body.location);

          const pin =
            clean(body.pin);


          const user =
            getUserByPhone(phone);


          if (!user) {

            sendJSON(
              res,
              404,
              {
                success: false,
                message:
                  "ব্যবহারকারী পাওয়া যায়নি"
              }
            );

            return;
          }


          if (!validPIN(pin)) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "প্রোফাইল পরিবর্তনের জন্য ৬ সংখ্যার PIN দিন"
              }
            );

            return;
          }


          if (
            user.pinHash !==
            hashPIN(pin)
          ) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ভুল PIN"
              }
            );

            return;
          }


          if (name) {

            user.name =
              name;

          }


          if (location) {

            user.location =
              location;

          }


          if (
            body.avatar !==
            undefined
          ) {

            const newAvatar =
              normalizeAvatar(
                body.avatar
              );

            user.avatar =
              newAvatar;

          }


          saveJSON(
            DB.users,
            users
          );


          /*
           * Update owner information
           * inside existing jobs.
           */

          jobs =
            jobs.map(job => {

              if (
                job.phone ===
                phone
              ) {

                return {

                  ...job,

                  ownerName:
                    user.name,

                  ownerAvatar:
                    user.avatar || ""

                };

              }

              return job;

            });


          saveJSON(
            DB.jobs,
            jobs
          );


          sendJSON(
            res,
            200,
            {

              success: true,

              message:
                "প্রোফাইল আপডেট হয়েছে",

              user:
                publicUser(user)

            }
          );

          return;
        }


        /* =================================
           GET JOBS
        ================================= */

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/api/jobs"
          )
        ) {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );


          const location =
            clean(
              url.searchParams.get(
                "location"
              )
            );


          const category =
            clean(
              url.searchParams.get(
                "category"
              )
            );


          const q =
            clean(
              url.searchParams.get(
                "q"
              )
            );


          let result =
            [...jobs];


          if (location) {

            result =
              result.filter(
                job =>
                  locationMatch(
                    job.location,
                    location
                  )
              );

          }


          if (
            category &&
            category !== "সব"
          ) {

            result =
              result.filter(
                job =>
                  normalize(
                    job.category
                  ) ===
                  normalize(
                    category
                  )
              );

          }


          if (q) {

            const search =
              normalize(q);


            result =
              result.filter(
                job => {

                  const text =
                    normalize(
                      [
                        job.title,
                        job.location,
                        job.category,
                        job.description,
                        job.ownerName
                      ].join(" ")
                    );


                  return text.includes(
                    search
                  );

                }
              );

          }


          result.sort(
            (a, b) =>
              new Date(
                b.createdAt
              ) -
              new Date(
                a.createdAt
              )
          );


          sendJSON(
            res,
            200,
            {

              success: true,

              count:
                result.length,

              location:
                location || null,

              category:
                category || null,

              query:
                q || null,

              jobs:
                result

            }
          );

          return;
        }


        /* =================================
           CREATE JOB
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/jobs"
        ) {

          const body =
            await readBody(req);


          const title =
            clean(body.title);

          const location =
            clean(body.location);

          const salary =
            clean(body.salary);

          const category =
            clean(body.category);

          const description =
            clean(body.description);

          const phone =
            clean(body.phone);

          const pin =
            clean(body.pin);


          if (
            !title ||
            !location ||
            !salary ||
            !category ||
            !description ||
            !phone ||
            !pin
          ) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "সব প্রয়োজনীয় তথ্য পূরণ করুন"
              }
            );

            return;
          }


          if (!validPIN(pin)) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
              }
            );

            return;
          }


          const user =
            getUserByPhone(phone);


          if (!user) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ব্যবহারকারী পাওয়া যায়নি"
              }
            );

            return;
          }


          if (
            user.pinHash !==
            hashPIN(pin)
          ) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ভুল PIN"
              }
            );

            return;
          }


          const job = {

            id:
              createID("job"),

            title,

            location,

            salary,

            category,

            description,

            phone,

            ownerName:
              user.name,

            ownerAvatar:
              user.avatar || "",

            createdAt:
              new Date().toISOString()

          };


          jobs.unshift(job);


          if (
            !saveJSON(
              DB.jobs,
              jobs
            )
          ) {

            sendJSON(
              res,
              500,
              {
                success: false,
                message:
                  "কাজ সংরক্ষণ করা যায়নি"
              }
            );

            return;
          }


          sendJSON(
            res,
            200,
            {

              success: true,

              message:
                "কাজ পোস্ট হয়েছে",

              job

            }
          );

          return;
        }


        /* =================================
           MY JOBS
        ================================= */

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/api/my-jobs"
          )
        ) {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );


          const phone =
            clean(
              url.searchParams.get(
                "phone"
              )
            );


          const result =
            jobs.filter(
              job =>
                job.phone === phone
            );


          result.sort(
            (a, b) =>
              new Date(
                b.createdAt
              ) -
              new Date(
                a.createdAt
              )
          );


          sendJSON(
            res,
            200,
            {

              success: true,

              jobs:
                result

            }
          );

          return;
        }


        /* =================================
           DELETE JOB
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/jobs/delete"
        ) {

          const body =
            await readBody(req);


          const id =
            clean(
              body.id ||
              body.jobId
            );

          const phone =
            clean(body.phone);

          const pin =
            clean(body.pin);


          if (
            !id ||
            !phone ||
            !pin
          ) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "তথ্য অসম্পূর্ণ"
              }
            );

            return;
          }


          if (!validPIN(pin)) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "PIN অবশ্যই ৬ সংখ্যার হতে হবে"
              }
            );

            return;
          }


          const user =
            getUserByPhone(phone);


          if (!user) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ব্যবহারকারী পাওয়া যায়নি"
              }
            );

            return;
          }


          if (
            user.pinHash !==
            hashPIN(pin)
          ) {

            sendJSON(
              res,
              401,
              {
                success: false,
                message:
                  "ভুল PIN"
              }
            );

            return;
          }


          const job =
            jobs.find(
              item =>
                item.id === id
            );


          if (!job) {

            sendJSON(
              res,
              404,
              {
                success: false,
                message:
                  "কাজ পাওয়া যায়নি"
              }
            );

            return;
          }


          if (
            job.phone !== phone
          ) {

            sendJSON(
              res,
              403,
              {
                success: false,
                message:
                  "এই কাজ মুছে ফেলার অনুমতি নেই"
              }
            );

            return;
          }


          jobs =
            jobs.filter(
              item =>
                item.id !== id
            );


          saveJSON(
            DB.jobs,
            jobs
          );


          sendJSON(
            res,
            200,
            {

              success: true,

              message:
                "কাজ মুছে ফেলা হয়েছে"

            }
          );

          return;
        }


        /* =================================
           SEND MESSAGE
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/messages/send"
        ) {

          const body =
            await readBody(req);


          const from =
            clean(body.from);

          const to =
            clean(body.to);

          const text =
            clean(body.text);


          if (
            !from ||
            !to ||
            !text
          ) {

            sendJSON(
              res,
              400,
              {
                success: false,
                message:
                  "মেসেজ লিখুন"
              }
            );

            return;
          }


          const sender =
            getUserByPhone(from);

          const receiver =
            getUserByPhone(to);


          if (
            !sender ||
            !receiver
          ) {

            sendJSON(
              res,
              404,
              {
                success: false,
                message:
                  "ব্যবহারকারী পাওয়া যায়নি"
              }
            );

            return;
          }


          const message = {

            id:
              createID("message"),

            from,

            to,

            text,

            createdAt:
              new Date().toISOString()

          };


          messages.push(
            message
          );


          if (
            messages.length >
            10000
          ) {

            messages =
              messages.slice(-10000);

          }


          saveJSON(
            DB.messages,
            messages
          );


          createNotification({

            phone: to,

            type: "message",

            title:
              "নতুন মেসেজ 💬",

            text:
              `${sender.name} আপনাকে একটি মেসেজ পাঠিয়েছে`,

            from

          });


          sendJSON(
            res,
            200,
            {

              success: true,

              message,

              notification:
                true

            }
          );

          return;
        }


        /* =================================
           GET MESSAGES
        ================================= */

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/api/messages"
          )
        ) {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );


          const me =
            clean(
              url.searchParams.get(
                "me"
              )
            );

          const other =
            clean(
              url.searchParams.get(
                "other"
              )
            );


          const result =
            messages.filter(
              message =>
                (
                  message.from === me &&
                  message.to === other
                ) ||
                (
                  message.from === other &&
                  message.to === me
                )
            );


          result.sort(
            (a, b) =>
              new Date(
                a.createdAt
              ) -
              new Date(
                b.createdAt
              )
          );


          sendJSON(
            res,
            200,
            {

              success: true,

              messages:
                result

            }
          );

          return;
        }


        /* =================================
           NOTIFICATIONS
        ================================= */

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/api/notifications"
          )
        ) {

          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );


          const phone =
            clean(
              url.searchParams.get(
                "phone"
              )
            );


          const result =
            notifications.filter(
              item =>
                item.phone === phone
            );


          result.sort(
            (a, b) =>
              new Date(
                b.createdAt
              ) -
              new Date(
                a.createdAt
              )
          );


          const unreadCount =
            result.filter(
              item =>
                !item.read
            ).length;


          sendJSON(
            res,
            200,
            {

              success: true,

              unreadCount,

              notifications:
                result.slice(
                  0,
                  100
                )

            }
          );

          return;
        }


        /* =================================
           READ NOTIFICATIONS
        ================================= */

        if (
          req.method === "POST" &&
          req.url === "/api/notifications/read"
        ) {

          const body =
            await readBody(req);


          const phone =
            clean(body.phone);


          let changed = false;


          notifications =
            notifications.map(
              item => {

                if (
                  item.phone === phone &&
                  !item.read
                ) {

                  changed = true;

                  return {
                    ...item,
                    read: true
                  };

                }

                return item;

              }
            );


          if (changed) {

            saveJSON(
              DB.notifications,
              notifications
            );

          }


          sendJSON(
            res,
            200,
            {

              success: true,

              message:
                "নোটিফিকেশন পড়া হয়েছে"

            }
          );

          return;
        }


        /* =================================
           NOT FOUND
        ================================= */

        sendJSON(
          res,
          404,
          {

            success: false,

            message:
              "Not Found"

          }
        );


      } catch (error) {

        console.error(
          "SERVER ERROR:",
          error
        );


        sendJSON(
          res,
          500,
          {

            success: false,

            message:
              "Server error",

            error:
              error.message

          }
        );

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

    console.log(
      "Location based job search enabled"
    );

    console.log(
      "Profile picture support enabled"
    );

  }
);