// backend/server.js
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');

const app = express();
const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// === FULL MERGED USER SCHEMA (ALL FEATURES) ===
const userSchema = new mongoose.Schema({
  fingerprintId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, unique: true, sparse: true },
  lastLoginAt: { type: Date },

  homeAddress: { type: String },
  homeLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  homeLocationUpdatedAt: { type: Date },

  // Journals
  journals: [{
    text: String,
    mediaUrl: String,
    caption: String,
    timestamp: { type: Date, default: Date.now },
  }],

  // Meditation
  meditationSessions: [{
    durationSeconds: { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
  }],

  // Quiz
  quizScores: [{
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
  }],

  // Location
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  locationUpdatedAt: { type: Date, default: Date.now },

  // Reminders
  reminders: [{
    date: String,
    time: String,
    message: String,
    createdBy: String, // family userId
    createdAt: { type: Date, default: Date.now }
  }],

  // backend/server.js — ADD THIS FIELD TO userSchema
family: [{
  userId: String,
  name: String,
  relation: String,
  photo: String,
  phone: String,
  addedAt: { type: Date, default: Date.now },

  // NEW: Home Address (Same as patient's home)
  homeAddress: { type: String },

  // NEW: GPS Coordinates (Same as patient's location)
  homeLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  homeLocationUpdatedAt: { type: Date },

  members: [{
    name: String,
    relation: String,
    photo: String,
    addedAt: { type: Date, default: Date.now }
  }]
}],

// Add inside userSchema
remarks: [{
  text: String,
  fromUserId: String,
  fromName: String,
  fromRelation: String,
  fromImage: String,          // ← NEW
  createdAt: { type: Date, default: Date.now }
}],

medications: [{
  name: String,        // e.g., "Medicine 1"
  time: String,        // e.g., "08:30"
  date: String,        // today's date, e.g., "2025-11-15"
  createdBy: String,   // familyUserId
  createdAt: { type: Date, default: Date.now }
}]
});

userSchema.index({ location: '2dsphere' });
const User = mongoose.model('User', userSchema);

// === FAMILY USER SCHEMA (UNCHANGED) ===
const familyUserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  photo: { type: String },
  relation: { type: String, required: true },
  patientEmail: { type: String, required: true },
  patientId: { type: String },
  phone: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },

  // === HOME ADDRESS (Shared with Patient) ===
  homeAddress: { type: String }, // e.g., "123 Green Park, Delhi, India"

  homeLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  homeLocationUpdatedAt: { type: Date },

  familyMembers: [{
    name: { type: String, required: true },
    photo: { type: String },
    relation: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }],

  reminders: [{
    date: String,
    time: String,
    message: String,
    createdBy: String,
    forPatient: String,
    createdAt: { type: Date, default: Date.now }
  }],

  // Add inside familyUserSchema
remarks: [{
  text: String,
  toPatientId: String,
  fromUserId: String,
  fromName: String,
  fromRelation: String,
  fromImage: String,          // ← NEW
  createdAt: { type: Date, default: Date.now }
}],

medications: [{
  name: String,        // e.g., "Medicine 1"
  time: String,        // e.g., "08:30"
  date: String,        // today's date, e.g., "2025-11-15"
  createdBy: String,   // familyUserId
  createdAt: { type: Date, default: Date.now }
}]
});

const FamilyUser = mongoose.model('FamilyUser', familyUserSchema);

// === META COLLECTION FOR CURRENT USER ===
const metaSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  currentUserId: { type: String },
  updatedAt: { type: Date, default: Date.now },
});
const Meta = mongoose.model('Meta', metaSchema, 'meta');

// ======================
// ALL API ROUTES
// ======================

// AUTH
app.post('/auth', async (req, res) => {
  const { fingerprintId } = req.body;
  try {
    let user = await User.findOne({ fingerprintId });
    if (user) {
      user.lastLoginAt = new Date();
      await user.save();

      await Meta.updateOne(
        { _id: 'current' },
        { $set: { currentUserId: user.userId, updatedAt: new Date() } },
        { upsert: true }
      );

      return res.json({
        success: true,
        user: {
          name: user.name,
          email: user.email,
          userId: user.userId,
          fingerprintId: user.fingerprintId,
          journals: user.journals,
          meditationSessions: user.meditationSessions || [],
        },
      });
    }

    const userId = `user_${fingerprintId}`;
    user = new User({ fingerprintId, userId, lastLoginAt: new Date() });
    await user.save();

    await Meta.updateOne(
      { _id: 'current' },
      { $set: { currentUserId: user.userId, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ success: true, newUser: true, userId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Fingerprint already registered' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE PROFILE
app.post('/save-profile', async (req, res) => {
  const { fingerprintId, name, email } = req.body;
  try {
    const existing = await User.findOne({ email, fingerprintId: { $ne: fingerprintId } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const updated = await User.findOneAndUpdate(
      { fingerprintId },
      { name, email },
      { new: true }
    );

    res.json({
      success: true,
      user: {
        name: updated.name,
        email: updated.email,
        userId: updated.userId,
        fingerprintId: updated.fingerprintId,
        journals: updated.journals,
        meditationSessions: updated.meditationSessions || [],
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE JOURNAL
app.post('/save-journal', async (req, res) => {
  const { userId, text, mediaUrl, caption } = req.body;
  try {
    const journalEntry = { text: text || '', timestamp: new Date() };
    if (mediaUrl) {
      journalEntry.mediaUrl = mediaUrl;
      journalEntry.caption = caption || '';
    }

    const user = await User.findOneAndUpdate(
      { userId },
      { $push: { journals: journalEntry } },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({ success: true, journals: user.journals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MEDITATION: SAVE
app.post('/meditation/save', async (req, res) => {
  const { userId, durationSeconds, startedAt, endedAt } = req.body;
  if (!userId || typeof durationSeconds !== 'number' || durationSeconds <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid payload' });
  }
  try {
    const session = {
      durationSeconds,
      startedAt: startedAt ? new Date(startedAt) : new Date(Date.now() - durationSeconds * 1000),
      endedAt: endedAt ? new Date(endedAt) : new Date(),
    };
    const user = await User.findOneAndUpdate(
      { userId },
      { $push: { meditationSessions: session } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, meditationSessions: user.meditationSessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MEDITATION: HISTORY
app.get('/meditation/history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: 'userId required' });
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const sessions = (user.meditationSessions || []).slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    res.json({ success: true, meditationSessions: sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// QUIZ: SAVE SCORE
app.post('/quiz/save-score', async (req, res) => {
  const { userId, score, total } = req.body;
  if (!userId || typeof score !== 'number' || typeof total !== 'number') {
    return res.status(400).json({ success: false, error: 'Invalid payload' });
  }
  try {
    const user = await User.findOneAndUpdate(
      { userId },
      { $push: { quizScores: { score, total, createdAt: new Date() } } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    return res.json({ success: true, quizScores: user.quizScores });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// QUIZ: HISTORY
app.get('/quiz/history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: 'userId required' });
  try {
    const user = await User.findOne({ userId }, { quizScores: 1, _id: 0 }).lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const scores = (user.quizScores || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ success: true, quizScores: scores });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// CURRENT USER
app.get('/current-user', async (req, res) => {
  try {
    const meta = await Meta.findById('current').lean();
    if (meta && meta.currentUserId) {
      const user = await User.findOne({ userId: meta.currentUserId }).lean();
      if (user) {
        return res.json({
          success: true,
          userId: user.userId,
          name: user.name || null,
          email: user.email || null,
        });
      }
    }
    const latest = await User.find({}, { userId: 1, name: 1, email: 1 })
      .sort({ lastLoginAt: -1 })
      .limit(1)
      .lean();
    if (latest && latest.length) {
      return res.json({ success: true, userId: latest[0].userId, name: latest[0].name || null, email: latest[0].email || null });
    }
    return res.status(404).json({ success: false, error: 'No current user' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// QUIZ: RUN SCRIPT
app.get('/quiz/run-script', async (req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, '../../memory-question-generator/memory-question-generator/test-api.py');
    const cwd = path.dirname(scriptPath);
    const candidates = [];
    if (process.env.PYTHON_EXECUTABLE) candidates.push(process.env.PYTHON_EXECUTABLE);
    candidates.push(path.join(cwd, 'venv', 'Scripts', 'python.exe'));
    candidates.push(path.join(cwd, 'venv', 'bin', 'python'));
    candidates.push('py');
    candidates.push('python');
    candidates.push('python3');

    const tryExec = (i) => {
      if (i >= candidates.length) {
        return res.status(500).json({ success: false, error: 'No working Python interpreter found.' });
      }
      const exe = candidates[i];
      execFile(
        exe,
        [scriptPath, '--json-only'],
        { cwd, env: process.env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) return tryExec(i + 1);
          let data;
          try { data = JSON.parse(stdout); }
          catch (e) {
            return res.status(500).json({ success: false, error: 'Failed to parse script output', stdout: stdout.slice(0, 1000) });
          }
          return res.json({ success: true, ...data, python: exe });
        }
      );
    };
    tryExec(0);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// FAMILY SIGNUP
app.post('/family-signup', async (req, res) => {
  const { name, email, password, photo, relation, patientEmail, phone } = req.body;
  try {
    const existing = await FamilyUser.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already used' });

    const patient = await User.findOne({ email: patientEmail });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `family_${Date.now()}`;

    const familyUser = new FamilyUser({
      userId, name, email, password: hashedPassword, photo, relation,
      patientEmail, patientId: patient.userId, phone,
    });

    await familyUser.save();
    res.json({ success: true, userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAMILY LOGIN
app.post('/family-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const familyUser = await FamilyUser.findOne({ email });
    if (!familyUser) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, familyUser.password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    const patient = await User.findOne({ userId: familyUser.patientId });

    res.json({
      success: true,
      familyUser: {
        userId: familyUser.userId,
        name: familyUser.name,
        email: familyUser.email,
        photo: familyUser.photo,
        relation: familyUser.relation,
        patientId: familyUser.patientId,
        patientName: patient?.name || 'Unknown',
        familyMembers: familyUser.familyMembers || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD FAMILY MEMBER
app.post('/add-family-member', async (req, res) => {
  const { userId, name, photo, relation } = req.body;
  try {
    const familyUser = await FamilyUser.findOneAndUpdate(
      { userId },
      { $push: { familyMembers: { name, photo, relation } } },
      { new: true }
    );
    if (!familyUser) return res.status(404).json({ error: 'Family user not found' });
    res.json({ success: true, familyMembers: familyUser.familyMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE LOCATION
app.post('/update-location', async (req, res) => {
  const { userId, latitude, longitude } = req.body;
  try {
    await User.updateOne({ userId }, { $unset: { 'location.updatedAt': '' } });
    const user = await User.findOneAndUpdate(
      { userId },
      {
        $set: {
          'location.type': 'Point',
          'location.coordinates': [longitude, latitude],
          locationUpdatedAt: new Date()
        }
      },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, location: user.location, updatedAt: user.locationUpdatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET PATIENT LOCATION
app.get('/get-patient-location', async (req, res) => {
  const { patientId } = req.query;
  try {
    const user = await User.findOne({ userId: patientId });
    if (!user) return res.status(404).json({ success: false, error: 'Patient not found' });
    res.json({ success: true, location: user.location, updatedAt: user.locationUpdatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD REMINDER
app.post('/add-reminder', async (req, res) => {
  const { familyUserId, patientId, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Reminder text required' });

  try {
    const aiRes = await fetch('http://127.0.0.1:5000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const aiData = await aiRes.json();
    const result = aiData.result;

    if (!result || result === 'NO') {
      return res.status(400).json({ error: 'No valid reminder found' });
    }

    const { date, time, message } = result;

    await User.updateOne(
      { userId: patientId },
      { $push: { reminders: { date, time, message, createdBy: familyUserId } } }
    );

    await FamilyUser.updateOne(
      { userId: familyUserId },
      { $push: { reminders: { date, time, message, forPatient: patientId } } }
    );

    res.json({ success: true, reminder: { date, time, message } });
  } catch (err) {
    console.error('Reminder error:', err);
    res.status(500).json({ error: 'Failed to set reminder' });
  }
});

// backend/server.js — ADD THIS ROUTE
app.post('/connect-family', async (req, res) => {
  const { familyUserId, patientId } = req.body;

  try {
    // 1. Get family user
    const familyUser = await FamilyUser.findOne({ userId: familyUserId });
    if (!familyUser) return res.status(404).json({ error: 'Family user not found' });

    // 2. Get patient
    const patient = await User.findOne({ userId: patientId });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // 3. Prepare family data
    const familyData = {
      userId: familyUser.userId,
      name: familyUser.name,
      relation: familyUser.relation,
      photo: familyUser.photo,
      phone: familyUser.phone,
      addedAt: new Date(),
      members: (familyUser.familyMembers || []).map(m => ({
        name: m.name,
        relation: m.relation,
        photo: m.photo,
        addedAt: m.addedAt || new Date()
      }))
    };

    // 4. Update patient: push family (or overwrite if you want one)
    const updatedPatient = await User.findOneAndUpdate(
      { userId: patientId },
      { $push: { family: familyData } },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Family connected to patient',
      family: updatedPatient.family
    });
  } catch (err) {
    console.error('Connect family error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/send-remark', async (req, res) => {
  const {
    familyUserId,
    patientId,
    text,
    fromUserId,
    fromName,
    fromRelation,
    fromImage          // ← NEW
  } = req.body;

  if (!text?.trim()) return res.status(400).json({ error: 'Remark text required' });

  const remark = {
    text: text.trim(),
    fromUserId,
    fromName,
    fromRelation,
    fromImage,                 // ← NEW
    createdAt: new Date()
  };

  try {
    // Save to Patient
    await User.updateOne(
      { userId: patientId },
      { $push: { remarks: remark } }
    );

    // Save to FamilyUser
    await FamilyUser.updateOne(
      { userId: familyUserId },
      { $push: { remarks: { ...remark, toPatientId: patientId } } }
    );

    res.json({ success: true, remark });
  } catch (err) {
    console.error('Send remark error:', err);
    res.status(500).json({ error: err.message });
  }
});

// backend/server.js — ADD THIS ROUTE
// backend/server.js — REPLACE THE ENTIRE ROUTE
// backend/server.js — REPLACE ENTIRE ROUTE
// backend/server.js — REPLACE ENTIRE ROUTE
app.get('/get-patient-progress', async (req, res) => {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId required' });

  try {
    const patient = await User.findOne({ userId: patientId })
      .select('meditationSessions quizScores name')
      .lean();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const formatUTCDate = (dateStr) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
      });
    };

    const formatUTCTime = (dateStr) => {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      });
    };

    // === MEDITATION ===
    const meditationData = (patient.meditationSessions || [])
      .map(s => {
        const startedAt = s.startedAt;
        return {
          date: formatUTCDate(startedAt),
          time: formatUTCTime(startedAt),
          fullDate: startedAt,
          durationSeconds: Number(s.durationSeconds), // ← FORCE NUMBER
          sessionId: s._id.toString()
        };
      })
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

    // === QUIZ ===
    const quizData = (patient.quizScores || [])
      .map(q => {
        const createdAt = q.createdAt;
        const score = Number(q.score);
        const total = Number(q.total);
        const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
        return {
          date: formatUTCDate(createdAt),
          time: formatUTCTime(createdAt),
          fullDate: createdAt,
          score,
          total,
          accuracy,
          quizId: q._id.toString()
        };
      })
      .sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));

    // === TOTAL TIME (SAFE) ===
    const totalMeditationSeconds = meditationData.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);

    res.json({
      success: true,
      patientName: patient.name || 'Patient',
      meditation: meditationData,
      quiz: quizData,
      totalMeditationSeconds // ← CRITICAL
    });
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// backend/server.js — FIXED: ONLY UPDATES homeLocation
app.post('/save-home-address', async (req, res) => {
  const { address, patientId, familyUserId } = req.body;
  if (!address?.trim()) return res.status(400).json({ error: 'Address required' });

  try {
    // GEOCODE
    const geoRes = await fetch(
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&apiKey=${process.env.GEOAPIFY_KEY}`
    );
    const geoData = await geoRes.json();

    if (!geoData.features?.length) {
      return res.status(400).json({ error: 'Invalid address. Try: "123 Main St, City, Country"' });
    }

    const { lon, lat } = geoData.features[0].properties;

    // UPDATE PATIENT → ONLY homeLocation
    await User.updateOne(
      { userId: patientId },
      {
        $set: {
          homeAddress: address,
          'homeLocation.type': 'Point',
          'homeLocation.coordinates': [lon, lat],
          homeLocationUpdatedAt: new Date()
        }
      }
    );

    // UPDATE FAMILY USER
    await FamilyUser.updateOne(
      { userId: familyUserId },
      {
        $set: {
          homeAddress: address,
          'homeLocation.type': 'Point',
          'homeLocation.coordinates': [lon, lat],
          homeLocationUpdatedAt: new Date()
        }
      }
    );

    res.json({ success: true, lat, lng: lon, address });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Failed to save address' });
  }
});

// backend/server.js
app.get('/get-patient-home', async (req, res) => {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId required' });

  try {
    const user = await User.findOne({ userId: patientId })
      .select('homeAddress homeLocation homeLocationUpdatedAt')
      .lean();

    if (!user || !user.homeLocation?.coordinates) {
      return res.status(404).json({ error: 'Home not set' });
    }

    res.json({
      success: true,
      homeAddress: user.homeAddress,
      homeLocation: user.homeLocation,
      updatedAt: user.homeLocationUpdatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// backend/server.js — ADD THIS ROUTE
app.post('/add-medication', async (req, res) => {
  const { familyUserId, patientId, name, time } = req.body;

  if (!name || !time || !familyUserId || !patientId) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const medication = {
    name,
    time,
    date: today,
    createdBy: familyUserId,
    createdAt: new Date()
  };

  try {
    // Save to Patient
    await User.updateOne(
      { userId: patientId },
      { $push: { medications: medication } }
    );

    // Save to FamilyUser
    await FamilyUser.updateOne(
      { userId: familyUserId },
      { $push: { medications: { ...medication, forPatient: patientId } } }
    );

    res.json({ success: true, medication: { name, time, date: today } });
  } catch (err) {
    console.error('Medication save error:', err);
    res.status(500).json({ error: 'Failed to save medication' });
  }
});

// backend/server.js — ADD THIS ROUTE
app.get('/get-today-medications', async (req, res) => {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId required' });

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const user = await User.findOne({ userId: patientId })
      .select('medications')
      .lean();

    if (!user) return res.status(404).json({ error: 'Patient not found' });

    const todayMeds = (user.medications || [])
      .filter(m => m.date === today)
      .reduce((acc, m) => {
        acc[m.name] = m.time;
        return acc;
      }, {});

    res.json({ success: true, medications: todayMeds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================
// MEDICINE TIME LED TRIGGER (NO ARDUINO CHANGE)
// ======================

const WebSocket = require('ws');

const ESP_IP = '172.16.197.93';
const WS_URL = `ws://${ESP_IP}:81`;

let ws = null;
let reconnecting = false;

// === Connect to ESP WebSocket ===
const connectESP = () => {
  if (ws?.readyState === WebSocket.OPEN || reconnecting) return;
  reconnecting = true;

  console.log('Connecting to ESP WebSocket...');
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('ESP Connected');
    reconnecting = false;
  });

  ws.on('close', () => {
    console.log('ESP Disconnected. Reconnecting in 5s...');
    setTimeout(connectESP, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err.message);
  });
};

// === Send command to ESP ===
const sendToESP = (command) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(command);
    console.log(`Sent to ESP: ${command}`);
  } else {
    console.warn(`ESP not connected. Dropped: ${command}`);
  }
};

// === Check medicine times every minute ===
const checkMedicineTimes = async () => {
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // "2025-11-15"
  const currentTime = now.toTimeString().slice(0, 5); // "12:30"

  try {
    const patients = await User.find({
      'medications.date': today,
      'medications.time': currentTime
    }).select('medications').lean();

    for (const patient of patients) {
      for (const med of patient.medications) {
        if (med.date === today && med.time === currentTime) {
          const led = med.name === 'Medicine 1' ? '1' : '2';

          // Turn ON
          sendToESP(`LED${led}`);
          console.log(`Medicine time hit: ${med.name} at ${currentTime}`);

          // Turn OFF after 12 seconds (2 sec buzzer + 10 sec buffer)
          setTimeout(() => {
            sendToESP(`LED${led}`);
            console.log(`LED${led} turned OFF after 12 sec`);
          }, 12000);
        }
      }
    }
  } catch (err) {
    console.error('Medicine time check error:', err);
  }
};

// === Start everything ===
const startMedicineLED = () => {
  connectESP();
  setInterval(checkMedicineTimes, 60 * 1000); // Every minute
  checkMedicineTimes(); // Run immediately
};

// === CALL IT ===
startMedicineLED();

// Health Check
app.get('/', (req, res) => res.send('NeuroLink Backend OK'));

// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});