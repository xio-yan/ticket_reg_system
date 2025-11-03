/**
 * Ticket Payment Registration System
 * Stack: Node.js + Express + SQLite + Socket.IO
 * Run:
 *   npm install
 *   npm start
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const XLSX = require('xlsx');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.db');

// ===== Initialize app, server, socket =====
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== SQLite setup =====
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    klass TEXT,          
    student_no TEXT,    
    name TEXT,           
    seat_area TEXT,     
    amount_due REAL,    
    paid INTEGER DEFAULT 0,
    paid_at TEXT,
    notes TEXT,
    serial TEXT          -- ✅流水號欄位
  );`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_students_studentno ON students(student_no);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_students_paid ON students(paid);`);
});

function nowISO() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ===== File upload (Excel) =====
const upload = multer({ dest: path.join(__dirname, 'uploads') });

function normalizeHeader(h) {
  if (!h) return '';
  const s = String(h).replace(/\s+/g, '').toLowerCase();
  if (['class','班級','班級別','班級名稱'].includes(s)) return 'klass';
  if (['studentno','學號','學員編號','學籍號'].includes(s)) return 'student_no';
  if (['name','姓名','學生姓名'].includes(s)) return 'name';
  if (['seat','seatarea','座位區','座位','區域'].includes(s)) return 'seat_area';
  if (['amount','amountdue','應收金額','金額','票價'].includes(s)) return 'amount_due';
  if (['phone','電話','手機','聯絡電話','mobile'].includes(s)) return 'phone';
  return s;
}

// Import Excel
app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw.length < 2) return res.status(400).json({ error: 'Empty sheet' });

    const headers = raw[0].map(normalizeHeader);
    const rows = raw.slice(1);
    let inserted = 0, updated = 0;

    const stmtInsert = db.prepare(
      `INSERT INTO students (klass, student_no, name, seat_area, amount_due, paid, paid_at, notes, serial, phone)
      VALUES (?,?,?,?,?,?,?, ?, ?, ?)`
    );
    const stmtUpdate = db.prepare(
      `UPDATE students SET klass=?, name=?, seat_area=?, amount_due=?, phone=? WHERE student_no=?`
    );

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      for (const r of rows) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i]; });
        const klass = obj['klass'] ?? '';
        const sno = String(obj['student_no'] ?? '').trim();
        const name = obj['name'] ?? '';
        const seat = obj['seat_area'] ?? '';
        const amount = parseFloat(obj['amount_due'] ?? 0) || 0;
        const phone = obj['phone'] ?? '';


        if (!sno && !name) continue;

        if (sno) {
          db.get('SELECT id FROM students WHERE student_no=?', [sno], (err, row) => {
            if (err) return;
            if (row) {
              stmtUpdate.run([klass, name, seat, amount, phone, sno]);
              updated++;
            } else {
              stmtInsert.run([klass, sno, name, seat, amount, 0, null, null, null, phone]);
              inserted++;
            }
          });
        } else {
          stmtInsert.run([klass, '', name, seat, amount, 0, null, null, null]);
          inserted++;
        }
      }
      db.run('COMMIT', () => {
        stmtInsert.finalize();
        stmtUpdate.finalize();
        fs.unlink(req.file.path, () => {});
        io.emit('data_changed');
        res.json({ ok: true, inserted, updated });
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'Import failed', detail: String(e) });
  }
});

// ===== Query & stats =====
app.get('/api/stats', (req, res) => {
  db.get('SELECT COUNT(*) AS total, SUM(CASE WHEN paid=1 THEN 1 ELSE 0 END) AS paid FROM students', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const total = row?.total || 0;
    const paid = row?.paid || 0;
    res.json({ total, paid, unpaid: total - paid });
  });
});

// List students
app.get('/api/students', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page || '1', 10);
  const limit = Math.min(200, parseInt(req.query.limit || '100', 10));
  const offset = (page - 1) * limit;

  let sql = 'SELECT * FROM students';
  const params = [];
  if (q) {
    sql += ' WHERE klass LIKE ? OR student_no LIKE ? OR name LIKE ? OR phone LIKE ? OR serial LIKE ?';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY paid ASC, klass ASC, student_no ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Create student
app.post('/api/students', (req, res) => {
  const { klass='', student_no='', name='', seat_area='', amount_due=0, phone='' } = req.body || {};

  const stmt = `INSERT INTO students (klass, student_no, name, seat_area, amount_due, paid, paid_at, notes, serial, phone)
              VALUES (?,?,?,?,?,?,?,?,?,?)`;

  db.run(stmt, [klass, String(student_no), name, seat_area, Number(amount_due)||0, 0, null, null, null, phone], function(err){
    if (err) return res.status(500).json({ error: err.message });
    io.emit('data_changed');
    res.json({ ok: true, id: this.lastID });
  });
});

// Update student
app.put('/api/students/:id', (req, res) => {
  const id = req.params.id;
  const { klass, student_no, name, seat_area, amount_due, notes, phone, serial } = req.body || {};

  db.get('SELECT paid FROM students WHERE id=?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    // ✅ 後端防呆：已付款必須4碼流水號
if (row?.paid && serial && !/^\d{4}$/.test(serial)) {
  return res.status(400).json({ error: '流水號必須為 4 位數字' });
}


    const allowSerial = row?.paid ? serial : null;

    const stmt = `UPDATE students 
      SET klass=?, student_no=?, name=?, seat_area=?, amount_due=?, notes=?, phone=?, serial=? 
      WHERE id=?`;
    db.run(stmt, [klass||'', String(student_no||''), name||'', seat_area||'', Number(amount_due)||0, notes||'', phone||'', allowSerial, id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      io.emit('data_changed');
      res.json({ ok: true, changes: this.changes });
    });
  });
});

// Pay (require 4-digit serial)
app.post('/api/students/:id/pay', (req, res) => {
  const id = req.params.id;
  const { serial } = req.body || {};

  if (!serial || !/^\d{4}$/.test(serial)) {
    return res.status(400).json({ error: '請輸入4位數流水號' });
  }

  db.run(
    'UPDATE students SET paid=1, paid_at=?, serial=? WHERE id=?',
    [nowISO(), serial, id],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      io.emit('data_changed');
      res.json({ ok: true });
    }
  );
});

// Cancel pay
app.post('/api/students/:id/cancel_pay', (req, res) => {
  const id = req.params.id;
  const { password } = req.body || {};
  if (password !== 'admin') {
    return res.status(403).json({ error: 'Invalid password' });
  }
  db.run('UPDATE students SET paid=0, paid_at=NULL, serial=NULL WHERE id=?', [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    io.emit('data_changed');
    res.json({ ok: true });
  });
});

// Delete student
app.delete('/api/students/:id', (req, res) => {
  const id = req.params.id;

  db.run(`DELETE FROM students WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    io.emit('data_changed');
    res.json({ ok: true, deleted: this.changes });
  });
});


// ===== Login API =====
const LOGIN_PASSWORD = "23rdkhuscsu"; // 你可以改密碼

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === LOGIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: '密碼錯誤' });
});


// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve client
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io
io.on('connection', () => {});

server.listen(PORT, () => {
  console.log(`✅ Ticket Reg System running at http://localhost:${PORT}`);
});
