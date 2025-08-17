const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
    origin: [
        'http://localhost:3000', // Local frontend
        'https://dairy-frontend-cawn.onrender.com' // Deployed frontend
    ]
}));

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT)
});

db.connect(err => {
  if (err) console.error("DB connection error:", err);
  else console.log("MySQL connected successfully");
});

// Root route
app.get('/', (req, res) => {
  res.send('API is running');
});

// Signup endpoint
app.post("/signup", async (req, res) => {
  const { name, account_no, email, password } = req.body;

  if (!name || !account_no || !password) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    const [existing] = await db.promise().query(
      "SELECT id FROM users WHERE account_no = ? OR email = ?",
      [account_no, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Account number or email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.promise().query(
      "INSERT INTO users (name, account_no, email, password) VALUES (?, ?, ?, ?)",
      [name, account_no, email, hashedPassword]
    );

    res.json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Login endpoint
app.post("/login", async (req, res) => {
  const { account_no, password } = req.body;

  if (!account_no || !password) {
    return res.status(400).json({ success: false, message: "Missing account number or password" });
  }

  try {
    const [rows] = await db.promise().query(
      "SELECT id, name, account_no, email, password FROM users WHERE account_no = ?",
      [account_no]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Incorrect account number or password" });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        account_no: user.account_no,
        email: user.email,
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Milk entry endpoint
app.post("/milk-entry", (req, res) => {
  const { account_no, entry_date, session, quantity, fat, snf, amount } = req.body;

  if (!account_no || !entry_date || !session || !quantity) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const validSessions = ["morning", "evening"];
  if (!validSessions.includes(session.toLowerCase())) {
    return res.status(400).json({ success: false, message: "Invalid session value" });
  }

  db.query("SELECT id FROM users WHERE account_no = ?", [account_no], (err, results) => {
    if (err) {
      console.error("DB error on user lookup:", err);
      return res.status(500).json({ success: false, message: "Database error on user lookup" });
    }
    if (results.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    const user_id = results[0].id;

    const sql = `
      INSERT INTO milk_entries
        (user_id, entry_date, session, quantity, fat, snf, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
      sql,
      [user_id, entry_date, session.toLowerCase(), quantity, fat, snf, amount],
      (insertErr, result) => {
        if (insertErr) {
          console.error("DB insert error:", insertErr);
          return res.status(500).json({ success: false, message: "Database error: " + insertErr.sqlMessage });
        }
        res.status(201).json({ success: true, message: "Milk entry added successfully", id: result.insertId });
      }
    );
  });
});

// Milk summary endpoint
app.get("/milk-summary/:account_no", (req, res) => {
  const account_no = req.params.account_no;

  db.query("SELECT id FROM users WHERE account_no = ?", [account_no], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (results.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    const user_id = results[0].id;

    const sql = `
      SELECT DATE_FORMAT(d.date, '%Y-%m-%d') AS date, s.session,
        ROUND(COALESCE(SUM(e.quantity),0), 2) AS total_quantity,
        ROUND(COALESCE(SUM(e.quantity * e.fat)/NULLIF(SUM(e.quantity),0),0), 2) AS avg_fat,
        ROUND(COALESCE(SUM(e.quantity * e.snf)/NULLIF(SUM(e.quantity),0),0), 2) AS avg_snf,
        ROUND(COALESCE(SUM(e.amount),0), 2) AS total_amount
      FROM (
        SELECT CURDATE() - INTERVAL n DAY AS date
        FROM (SELECT 9 AS n UNION ALL SELECT 8 UNION ALL SELECT 7 UNION ALL
              SELECT 6 UNION ALL SELECT 5 UNION ALL SELECT 4 UNION ALL
              SELECT 3 UNION ALL SELECT 2 UNION ALL SELECT 1 UNION ALL SELECT 0) AS days
      ) AS d
      CROSS JOIN (SELECT 'morning' AS session UNION ALL SELECT 'evening') AS s
      LEFT JOIN milk_entries e
        ON DATE(e.entry_date) = d.date AND e.session = s.session AND e.user_id = ?
      GROUP BY d.date, s.session
      ORDER BY d.date ASC, FIELD(s.session, 'morning','evening');
    `;

    db.query(sql, [user_id], (err2, summary) => {
      if (err2) return res.status(500).json({ success: false, message: err2.message });
      res.json(summary);
    });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
