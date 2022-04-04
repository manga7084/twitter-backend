const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");

const app = express();
const PORT = process.env.PORT || 3000;
let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

//Middleware
app.use(express.json());

//Starting the server and connecting to db
const serverAndDb = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(PORT, () => {
      console.log(`Server started at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.log(`Error: ${error.message}`);
    process.exit(1);
  }
};

serverAndDb();

//Helper Functions

const validPassword = async (password) => {
  return password.length >= 6;
};

//MiddleWares
const validator = async (req, res, next) => {
  const { username, password } = req.body;
  const query = `
        SELECT *
        FROM user
        WHERE username = "${username}"
    ;`;

  const user = await db.get(query);
  if (user !== undefined) {
    res.status(400);
    res.send("User already exists");
  } else if (!validPassword(password)) {
    res.status(400);
    res.send("Password is too short");
  } else {
    next();
  }
};

const authenticateToken = (req, res, next) => {
  let jwtToken;
  const authHeader = req.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    res.status(401);
    res.send("Invalid JWT token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        res.status(401);
        res.send("Invalid JWT Token");
      } else {
        req.username = payload.username;
        next();
      }
    });
  }
};

//API-1: Register a user
app.post("/register/", validator, async (req, res) => {
  const { username, password, name, gender } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const query = `
        INSERT INTO user(username, password, name, gender)
        VALUES ("${username}", "${hashedPassword}", "${name}", "${gender}")
    ;`;
  const user = await db.run(query);
  res.send("User created successfully");
});

//API-2: Login a user
app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const query = `
        SELECT *
        FROM user
        WHERE username = "${username}"
    ;`;

  const user = await db.get(query);
  if (user === undefined) {
    res.status(400);
    res.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      res.status(400);
      res.send("Invalid password");
    } else {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      res.send({ jwtToken });
    }
  }
});

//API-3: GET 4 latest tweets of people that the user follows
app.get("/user/tweets/feed/", authenticateToken, async (req, res) => {
  const { username } = req;
  const query = `
        SELECT u.username, tweet.tweet, tweet.date_time AS dateTime
        FROM tweet
        INNER JOIN (
                SELECT user.username, following.following_user_id
                FROM user
                INNER JOIN (
                        SELECT follower.following_user_id
                        FROM user
                        INNER JOIN follower
                            ON user.user_id = follower.follower_user_id
                        WHERE user.username = "${username}"
                    ) AS following
                    ON user.user_id = following.following_user_id
                ) AS u
            ON tweet.user_id = u.following_user_id
            LIMIT 4
    `;
  const tweets = await db.all(query);
  res.send(tweets);
});

//API-4: GET list of all the people whom the user is following
app.get("/user/following/", authenticateToken, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT user.name
    FROM (
            SELECT following_user_id
            FROM (
                    SELECT *
                    FROM user
                    INNER JOIN follower
                        ON follower.follower_user_id = user.user_id
                )
            WHERE username = "${username}"
        ) AS following
    INNER JOIN user
        ON user.user_id = following.following_user_id
    ;`;

  const following = await db.all(query);
  res.send(following);
});

//API-5: GET the list of followers of the user
app.get("/user/followers/", authenticateToken, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT user.name
    FROM (
            SELECT *
            FROM user
            INNER JOIN follower
                ON follower.following_user_id = user.user_id
            WHERE user.username = "${username}"    
        ) AS followers
    INNER JOIN user
        ON user.user_id = followers.follower_user_id
    ;`;

  const followers = await db.all(query);
  res.send(followers);
});

//API-6: GET a tweet from only those users that the user is following
app.get("/tweets/:tweetId/", authenticateToken, async (req, res) => {
  const { username } = req;
  const { tweetId } = req.params;
  const query = `
            SELECT tweet.tweet_id, tweet.tweet, tweet.date_time
            FROM (
                SELECT *
                FROM user
                INNER JOIN follower
                    ON user.user_id = follower.follower_user_id
                WHERE user.username = "${username}"
            ) AS following
            INNER JOIN tweet
                ON tweet.user_id = following.following_user_id
            WHERE tweet.tweet_id = ${tweetId}
            `;
  const tweet = await db.get(query);
  if (tweet === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    const likesQuery = `
                    SELECT COUNT(like_id) AS likes
                    FROM like
                    WHERE tweet_id = ${tweetId}
                ;`;
    const likes = await db.get(likesQuery);
    const repliesQuery = `
                    SELECT COUNT(reply_id) AS replies
                    FROM reply
                    WHERE tweet_id = ${tweetId}
                ;`;
    const replies = await db.get(repliesQuery);
    res.send({
      tweet: tweet.tweet,
      likes: likes.likes,
      replies: replies.replies,
      dateTime: tweet.date_time,
    });
  }
});

//API-7: GET the list of users who the user is following who have liked the tweet
app.get("/tweets/:tweetId/likes/", authenticateToken, async (req, res) => {
  const { username } = req;
  const { tweetId } = req.params;
  const query = `
  SELECT f.name
  FROM like
  INNER JOIN (SELECT *
  FROM (SELECT user.user_id, user.name
    FROM (SELECT user.user_id, follower.following_user_id 
          FROM user
            INNER JOIN follower
                ON user.user_id = follower.follower_user_id
            WHERE user.username = "${username}") AS following
        INNER JOIN user
            ON user.user_id = following.following_user_id)) AS f
    ON f.user_id = like.user_id
    WHERE like.tweet_id = ${tweetId}
    ;`;

  const tweets = await db.all(query);
  if (tweets === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    res.send({ likes: tweets.map((tweet) => tweet.name) });
  }
});

//API-8: GET the list of replies of the users whom the user is following
app.get("/tweets/:tweetId/replies/", authenticateToken, async (req, res) => {
  const { username } = req;
  const { tweetId } = req.params;
  const query = `
        SELECT f.name ,reply.reply
        FROM reply
        INNER JOIN (
            SELECT user.user_id, user.name
            FROM (SELECT follower.following_user_id, user.name
                FROM user
                INNER JOIN follower
                    ON user.user_id = follower.follower_user_id
                WHERE user.username = "${username}") AS following
            INNER JOIN user
                ON user.user_id = following.following_user_id) AS f
        ON f.user_id = reply.user_id
        WHERE reply.tweet_id = ${tweetId}
        ;`;

  const replies = await db.all(query);
  if (replies === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    res.send(replies);
  }
});

//API-9: GET all tweets made by a user
app.get("/user/tweets/", authenticateToken, async (req, res) => {
  try {
    const { username } = req;
    const query = `
        SELECT tweet.tweet_id, tweet.tweet, tweet.date_time
        FROM tweet
        INNER JOIN user
            ON tweet.user_id = user.user_id
        WHERE user.username = "${username}"
    `;

    const likesQuery = `
        SELECT q.tweet_id, q.tweet, COUNT(q.tweet_id) AS likes, q.date_time AS dateTime
        FROM like
        INNER JOIN (${query}) AS q
            ON like.tweet_id = q.tweet_id
        GROUP BY q.tweet_id
    `;
    const repliesQuery = `
        SELECT q.tweet_id, COUNT(q.tweet_id) AS replies
        FROM reply
        INNER JOIN (${query}) AS q
            ON reply.tweet_id = q.tweet_id
        GROUP BY q.tweet_id
    `;

    const finalQuery = `
        SELECT l.tweet, l.likes, r.replies, l.dateTime
        FROM (${likesQuery}) AS l
        INNER JOIN (${repliesQuery}) AS r
            ON l.tweet_id = r.tweet_id
    ;`;

    const tweets = await db.all(finalQuery);
    res.send(tweets);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
});

//API-10: CREATE a tweet
app.post("/user/tweets/", authenticateToken, async (req, res) => {
  const { username } = req;
  const { tweet } = req.body;
  const userIdQuery = `
        SELECT user_id
        FROM user
        WHERE username = "${username}"
    ;`;
  const { user_id } = await db.get(userIdQuery);
  const date = format(new Date(), "yyyy-MM-dd hh-mm-ss");
  const query = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES ("${tweet}", ${user_id}, "${date}")
  `;
  const newTweet = await db.run(query);
  res.send("Created a Tweet");
});

//API-11: DELETE a tweet
app.delete("/tweets/:tweetId/", authenticateToken, async (req, res) => {
  const { username } = req;
  const { tweetId } = req.params;
  const userTweetsTable = `
        SELECT * FROM tweet
        INNER JOIN (
            SELECT user.user_id, user.username, tweet.tweet, tweet.tweet_id
            FROM tweet
            INNER JOIN user
                ON tweet.user_id = user.user_id
            WHERE user.username = "${username}"
        ) AS t
        ON tweet.tweet_id = t.tweet_id
        WHERE tweet.tweet_id = ${tweetId}
    `;

  const user = await db.get(userTweetsTable);
  if (user === undefined) {
    res.status(400);
    res.send("Invalid Request");
  } else {
    const query = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId}
      ;`;

    const tweet = await db.run(query);
    res.send("Tweet Removed");
  }
  res.send(user);
});

module.exports = app;
