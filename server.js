require("dotenv").config()

const admin = require("firebase-admin")

let serviceAccount

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
    )
} else {
    serviceAccount = require("./trafon-insurance-firebase-adminsdk-fbsvc-c049a632b0.json")
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const nodemailer = require("nodemailer")
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
})

const express = require("express")
const axios = require("axios")
const cors = require("cors")
const moment = require("moment")

const app = express()

app.use(cors())
app.use(express.json())

app.get("/", (req, res) => {
    res.send("Trafon Backend Running")
})

app.post("/stkpush", async (req, res) => {
    try {
        const { phone, amount } = req.body

        const auth = Buffer.from(
            process.env.CONSUMER_KEY + ":" + process.env.CONSUMER_SECRET
        ).toString("base64")

        const tokenResponse = await axios.get(
            "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            { headers: { Authorization: `Basic ${auth}` } }
        )

        const accessToken = tokenResponse.data.access_token

        const timestamp = moment().format("YYYYMMDDHHmmss")

        const password = Buffer.from(
            process.env.SHORTCODE + process.env.PASSKEY + timestamp
        ).toString("base64")

        const response = await axios.post(
            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            {
                BusinessShortCode: process.env.SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: amount,
                PartyA: phone,
                PartyB: process.env.SHORTCODE,
                PhoneNumber: phone,
                CallBackURL: process.env.CALLBACK_URL,
                AccountReference: "Trafon Insurance",
                TransactionDesc: "Insurance Payment"
            },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        )

        res.json(response.data)
    } catch (error) {
        console.log(error.response?.data)
        res.status(500).json({
            error: error.response?.data || error.message
        })
    }
})

app.post("/send-email", async (req, res) => {
    try {
        const { to, subject, text } = req.body

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            text
        })

        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post("/send-notification", async (req, res) => {
    try {
        const { token, title, body } = req.body

        const message = {
            notification: { title, body },
            token
        }

        const response = await admin.messaging().send(message)

        res.json(response)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post("/callback", async (req, res) => {
    try {
        console.log("M-Pesa Callback:", JSON.stringify(req.body, null, 2))

        res.json({
            ResultCode: 0,
            ResultDesc: "Accepted"
        })
    } catch (error) {
        console.log(error)
    }
})

async function sendPushNotification(token, title, body) {
    const message = {
        notification: { title, body },
        token
    }

    await admin.messaging().send(message)
}

const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`)
        process.exit(1)
    }
    throw error
})