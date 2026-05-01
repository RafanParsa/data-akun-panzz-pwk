const express = require('express');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();

// Database Connection (Singleton for Vercel)
let isConnected = false;
const connectDB = async () => {
    if (isConnected) return;
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
        console.log('Connected to MongoDB Atlas');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
};

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ message: 'Database Connection Error', error: err.message });
    }
});

// Schema
const Account = mongoose.models.Account || mongoose.model('Account', new mongoose.Schema({
    no: Number,
    kodeAkun: { type: String, required: true, unique: true },
    gmail: String,
    passwordGmail: String,
    passwordML: String,
    hargaBeli: Number,
    hargaJual: Number,
    keterangan: { type: String, default: 'Ready' }
}));

app.use(cors());
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'panzz-store-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
}));

// Static files (This is important for Vercel)
app.use(express.static(path.join(process.cwd())));

// Home Route
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

// Middleware
const checkAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) next();
    else res.status(401).json({ message: 'Unauthorized' });
};

// Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'password123';
    
    if (username === adminUser && password === adminPass) {
        req.session.isAdmin = true;
        res.json({ message: 'Success' });
    } else {
        res.status(401).json({ message: 'Username/Password Salah' });
    }
});

app.get('/api/auth-status', (req, res) => {
    res.json({ loggedIn: !!(req.session && req.session.isAdmin) });
});

app.get('/api/export-excel', checkAuth, async (req, res) => {
    try {
        const accounts = await Account.find().sort({ no: 1 });
        const data = accounts.map(acc => ({
            "No": acc.no,
            "Kode Akun": acc.kodeAkun,
            "Gmail": acc.gmail,
            "Password Gmail": acc.passwordGmail,
            "Password ML": acc.passwordML,
            "Harga Beli": acc.hargaBeli,
            "Harga Jual": acc.hargaJual,
            "Keterangan": acc.keterangan
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Penjualan");
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Data_Penjualan_PanzzStore.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Success' });
});

// Account APIs
app.get('/api/accounts', checkAuth, async (req, res) => {
    try {
        const data = await Account.find().sort({ no: 1 });
        res.json(data.map(acc => ({
            "No": acc.no,
            "Kode Akun": acc.kodeAkun,
            "Gmail": acc.gmail,
            "Password Gmail": acc.passwordGmail,
            "Password ML": acc.passwordML,
            "Harga Beli": acc.hargaBeli,
            "Harga Jual": acc.hargaJual,
            "Keterangan": acc.keterangan
        })));
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data: ' + error.message });
    }
});

app.post('/api/accounts', checkAuth, async (req, res) => {
    try {
        const body = req.body;
        
        // Cek apakah Kode Akun sudah ada
        const existing = await Account.findOne({ kodeAkun: body["Kode Akun"] });
        if (existing) {
            return res.status(400).json({ message: 'Kode Akun sudah terdaftar!' });
        }

        if (!body.No) {
            const last = await Account.findOne().sort({ no: -1 });
            body.No = (last ? last.no : 0) + 1;
        }
        
        const newAcc = new Account({
            no: body.No,
            kodeAkun: body["Kode Akun"],
            gmail: body.Gmail,
            passwordGmail: body["Password Gmail"],
            passwordML: body["Password ML"],
            hargaBeli: body["Harga Beli"],
            hargaJual: body["Harga Jual"],
            keterangan: body.Keterangan
        });
        
        await newAcc.save();
        res.status(201).json(body);
    } catch (error) {
        res.status(500).json({ message: 'Gagal menyimpan: ' + error.message });
    }
});

app.put('/api/accounts/:kode', checkAuth, async (req, res) => {
    try {
        const updated = await Account.findOneAndUpdate(
            { kodeAkun: decodeURIComponent(req.params.kode).trim() },
            req.body,
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'Data tidak ditemukan' });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: 'Gagal update: ' + error.message });
    }
});

app.delete('/api/accounts/:kode', checkAuth, async (req, res) => {
    try {
        const result = await Account.deleteOne({ kodeAkun: decodeURIComponent(req.params.kode).trim() });
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Data tidak ditemukan' });
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus: ' + error.message });
    }
});

// For Vercel
module.exports = app;

// For Local
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Run on http://localhost:${PORT}`));
}
