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
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
})

const db = admin.firestore()

const axios = require("axios")
const nodemailer = require("nodemailer")
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
})

const express = require("express")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

app.get("/", (req, res) => {
    res.send("Trafon Backend Running")
})


app.post("/callback", async (req, res) => {

    try {

        console.log("MPESA CALLBACK")

        const callback =
            req.body.Body.stkCallback

        console.log(callback)

        if (callback.ResultCode === 0) {

            const items =
                callback.CallbackMetadata.Item

            let receipt = ""
            let amount = 0
            let phone = ""

            items.forEach(item => {

                if (item.Name === "MpesaReceiptNumber") {
                    receipt = item.Value
                }

                if (item.Name === "Amount") {
                    amount = item.Value
                }

                if (item.Name === "PhoneNumber") {
                    phone = item.Value
                }

            })

            await db.collection("payments")
                .add({
                    phone,
                    amount,
                    receipt,
                    status: "completed",
                    createdAt: new Date()
                })

            console.log("PAYMENT SAVED")
        }

        res.sendStatus(200)

    } catch (error) {

        console.log(error)

        res.sendStatus(500)
    }

})

async function getAccessToken() {

    const consumerKey = process.env.CONSUMER_KEY
    const consumerSecret = process.env.CONSUMER_SECRET

    const auth = Buffer.from(
        `${consumerKey}:${consumerSecret}`
    ).toString("base64")

    const response = await axios.get(
        "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        {
            headers: {
                Authorization: `Basic ${auth}`
            }
        }
    )

    return response.data.access_token
}
app.post("/stkpush", async (req, res) => {

    try {

        const token = await getAccessToken()

        const phone = req.body.phone

        const shortcode = process.env.SHORTCODE
        const passkey = process.env.PASSKEY

        const timestamp = new Date()
            .toISOString()
            .replace(/[-:.TZ]/g, "")
            .slice(0, 14)

        const password = Buffer.from(
            shortcode + passkey + timestamp
        ).toString("base64")

        const response = await axios.post(
            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            {
                BusinessShortCode: shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: 1,
                PartyA: phone,
                PartyB: shortcode,
                PhoneNumber: phone,
                CallBackURL: process.env.CALLBACK_URL,
                AccountReference: "Trafon",
                TransactionDesc: "Insurance Payment"
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        )

        res.json(response.data)

    } catch (error) {

        console.log(error.response?.data || error.message)

        res.status(500).json({
            error: "STK Push Failed"
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