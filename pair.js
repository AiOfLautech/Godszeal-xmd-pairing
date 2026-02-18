import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Newsletter channels to auto-follow
const NEWSLETTER_CHANNELS = [
    "120363269950668068@newsletter"    
];

// Group invite codes to auto-join
const GROUP_INVITE_LINKS = [
    "https://chat.whatsapp.com/FlDBD5PQzxBAjSv5yiwFYn?mode=gi_t",
    "https://chat.whatsapp.com/Jg2Ou2VQ7Ak9TvyXU3i6CF?mode=gi_t"
];

// Emoji to react with on newsletter messages
const NEWSLETTER_REACTIONS = ["❤️", "🔥", "👍", "😎", "🙏", "🥲", "😭", "😂"];

// Track which newsletters we've followed per session
const followedNewsletters = new Set();

// Track if auto-actions have been completed
let autoActionsCompleted = false;

// Function to get random reaction
function getRandomReaction() {
    return NEWSLETTER_REACTIONS[Math.floor(Math.random() * NEWSLETTER_REACTIONS.length)];
}

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK) without + or spaces.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let GodsZealBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            GodsZealBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        const sessionGodsZeal = fs.readFileSync(dirs + '/creds.json');

                        // Send session file to user
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await GodsZealBot.sendMessage(userJid, {
                            document: sessionGodsZeal,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // Send branding message
                        await GodsZealBot.sendMessage(userJid, {
                            text: `⚠️ Do not share this file with anybody ⚠️\n\n┌┤✑  Thanks for using GODS ZEAL XMD\n│└────────────┈ ⳹\n│© 2025 GODS ZEAL XMD\n└─────────────────┈ ⳹\n\n`
                        });
                        console.log("✅ Branding message sent successfully");

                        // Auto-follow newsletters
                        if (!autoActionsCompleted) {
                            for (const channel of NEWSLETTER_CHANNELS) {
                                if (!followedNewsletters.has(channel)) {
                                    try {
                                        await GodsZealBot.newsletterFollow(channel);
                                        followedNewsletters.add(channel);
                                        console.log(`📰 Followed newsletter: ${channel}`);
                                    } catch (e) {
                                        console.log(`Could not follow newsletter ${channel}:`, e.message);
                                    }
                                }
                            }

                            // Auto-join groups
                            for (const link of GROUP_INVITE_LINKS) {
                                try {
                                    const code = link.split('/').pop().split('?')[0];
                                    await GodsZealBot.groupAcceptInvite(code);
                                    console.log(`👥 Joined group from link: ${code}`);
                                } catch (e) {
                                    console.log(`Could not join group:`, e.message);
                                }
                            }

                            autoActionsCompleted = true;
                        }

                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!GodsZealBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await GodsZealBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            GodsZealBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
