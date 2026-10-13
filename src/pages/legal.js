import { h, clear } from '../lib/dom.js'
import { CONFIG, isPlaceholder, operatorConfigured } from '../config.js'
import { TERMS_VERSION } from '../version.js'

const C = CONFIG
const who = () => (isPlaceholder(C.operatorName) ? '[operator name not set]' : C.operatorName)
const mail = () => (isPlaceholder(C.contactEmail) ? '[contact email not set]' : C.contactEmail)
const law = () => (isPlaceholder(C.jurisdiction) ? '[jurisdiction not set]' : C.jurisdiction)
const region = () => (isPlaceholder(C.dataRegion) ? '[data region not set]' : C.dataRegion)

// Each section: { h: heading, p: [paragraphs], ul: [bullets] }  (all rendered as plain text)
const TERMS = () => [
  { h: '1. Who we are and what you are agreeing to', p: [
    `${C.appName} (the "Service") is a web chat application operated by ${who()} ("we", "us"). By creating an account or using the Service you agree to these Terms of Use and to our Privacy Policy and Important Disclosures. If you do not agree, do not use the Service.`] },
  { h: '2. Test (beta) release', p: [
    'The Service is an early test release. It may contain bugs, change without notice, be interrupted, or be reset. Accounts, rooms and messages may be lost or deleted without warning. Do not rely on it for anything important or time-critical.'] },
  { h: '3. Eligibility and your account', ul: [
    `You must be at least ${C.minAge} years old.`,
    'Give accurate information, keep one account per person, and keep your password secret. You are responsible for what happens under your account.',
    'Tell us at once if you think your account has been compromised.'] },
  { h: '4. Licence to use the Service', p: [
    'We give you a personal, non-exclusive, non-transferable, revocable licence to use the Service through its web interface for its intended purpose, subject to these Terms. You may not copy, resell, scrape, reverse engineer or attack the Service, except where the law gives you a right to do so that cannot be excluded.',
    'These Terms cover use of the hosted Service only. If the application\'s source code is published in a public repository, it is licensed under whatever licence is stated in that repository; if none is stated, all rights are reserved by its author. Third-party open-source components are listed in the Disclosures and keep their own licences.'] },
  { h: '5. Your content', ul: [
    'You keep ownership of the messages and other content you post.',
    '"Content" includes your messages, profile picture, bio, username and any files (photos, videos, audio, voice notes, PDFs, text files) you send and any status update you post. You give us a non-exclusive, worldwide, royalty-free licence to store, process and display your content to the members of the rooms you post in (and, for your picture, bio and username, to other signed-in users), and to our technical providers, only as needed to run, secure and moderate the Service.',
    'Only upload files you own or have permission to share. Do not upload copyrighted music, films or photos that are not yours to share.',
    'Other members can read, copy and screenshot what you post. We cannot delete copies other people make.',
    'You are responsible for your content and promise you have the right to share it.'] },
  { h: '6. Acceptable use', p: ['You must not use the Service to:'], ul: [
    'break the law or encourage others to, or post content that is unlawful;',
    'harass, threaten, abuse, stalk, defame or discriminate against anyone, or share hateful or violent extremist content;',
    'post sexual content involving minors (we will report this to the authorities), or sexually explicit content, including in profile pictures, bios and files;',
    'upload malware, files that exploit software, or files you do not have the right to share;',
    'share other people\'s private information without their permission, or impersonate anyone;',
    'send spam, scams, phishing, malware, or bulk or automated messages;',
    'try to access other people\'s accounts or data, probe or overload the Service, or bypass its limits or security;',
    'create accounts with false details, or create accounts to evade a suspension.'] },
  { h: '6a. Status updates and calls', ul: [
    'Status updates (text, photo, video or audio) are visible for 24 hours to people who share a chat with you, unless you switch sharing off in Settings. Viewers can see who viewed them and can report them. Expired updates may stay stored until you next open the app.',
    'Free voice and video calls are available between two people who have each sent the other at least one message in their direct chat, and inside group chats between members of that group (up to 6 people at a time). Calls go directly between your devices, or through a relay server when a network blocks direct connections; we do not record them. Do not record or share a call without the other people\'s consent where the law requires it.',
    'All rules in section 6 apply equally to voice notes, status updates and calls (for example, no harassment, no unwanted or sexual calls).'] },
  { h: '6b. Reactions, likes and comments', ul: [
    'Emoji reactions on messages are visible to everyone in that chat. Likes on a status are visible to the person who posted it. Comments on a status are private replies: only the person who posted the status and the person who wrote the comment can see them. The author can delete or report comments.',
    'The rules in section 6 apply to comments too. A person who views your status can save its photo, video or audio to their device, and nobody can stop screenshots; only post what you are happy to have saved.'] },
  { h: '7. Reporting and moderation', p: [
    'Every message from another person has a Report option. Reports (including a copy of the reported message and a reference to any attached file) are sent to us and reviewed manually by the operator, who is a person, not a 24/7 moderation team. We may remove content (including files and profile pictures), restrict features, or suspend or delete accounts that break these Terms or put others or the Service at risk. We are not obliged to monitor content and do not promise to act on every report or within a set time.'] },
  { h: '8. Do not share sensitive information', p: [
    'Messages, files, voice notes and status updates are not end-to-end encrypted (call audio and video are encrypted between the two devices, but the set-up of a call goes through our database). They are stored in readable form on our provider\'s servers and can be accessed by the operator (see the Privacy Policy). Do not send passwords, card or bank details, photos of documents, ID numbers, health information or anything else you would not be comfortable with the operator or a room member seeing.'] },
  { h: '9. Availability and third parties', p: [
    'The Service relies on third-party providers (Supabase for accounts, database, file storage, real-time delivery and account emails; GitHub for hosting the web pages). Free plans can be limited, paused or withdrawn, and email delivery may be delayed or restricted. Files are not scanned for viruses or harmful content, so open files from people you do not know with care. We do not guarantee that the Service will be available, uninterrupted or error-free.'] },
  { h: '10. Disclaimer and limit of liability', p: [
    'To the fullest extent permitted by law, the Service is provided "as is" and "as available", without warranties of any kind. To the fullest extent permitted by law, we are not liable for indirect, incidental or consequential loss, or for loss of data, profit or goodwill, arising from your use of the Service. Because the Service is free, our total liability for any claim relating to it is limited to the amount you paid us for it (zero).',
    'Nothing in these Terms excludes or limits liability that cannot be excluded or limited by law (for example for fraud, or for gross negligence or intentional misconduct where the law does not allow exclusion), or any non-waivable rights you have under consumer-protection or data-protection law.'] },
  { h: '11. Ending your use', p: [
    'You can stop using the Service at any time and can permanently delete your account from the Profile page (see the Privacy Policy for what is deleted). We may suspend or end your access if you break these Terms, if required by law, or if we discontinue the Service.'] },
  { h: '12. Changes to these Terms', p: [
    'We may update these Terms, the Privacy Policy and the Disclosures. When we make a material change we will change the version number and ask you to accept the new version before you continue using the Service. If you do not accept, you can download your data and delete your account.'] },
  { h: '13. Governing law', p: [
    `These Terms are governed by the laws of ${law()}, without limiting any mandatory rights you have under the laws of the country where you live.`] },
  { h: '14. Contact', p: [`Questions, reports or legal requests: ${mail()}.`] },
]

const PRIVACY = () => [
  { h: '1. Who is responsible for your data', p: [
    `${who()} decides why and how your personal information is processed (the "responsible party" under South Africa's POPIA and the "controller" under laws such as the GDPR). Contact: ${mail()}.`] },
  { h: '2. What we collect', ul: [
    'Account data: your email address, your username, an optional short bio, an optional profile picture, the time the account was created, and which version of the Terms/Privacy Policy you accepted and when. Your password is handled by Supabase Auth and stored only as a salted hash - we cannot see it.',
    'Content you create: messages (text, send time, edit time), files you send (photos, videos, audio, PDFs, text files, with their file name, type and size), room names, which rooms you belong to and your role (admin/member) in them, and any abuse reports you file (including a copy of the reported message).',
    'Voice notes are stored like other files (private storage, only chat members). Status updates and their files are stored for 24 hours of visibility, plus a list of who viewed each one (visible to you as the author).',
    'Read receipts: the time you last read each chat is stored so unread counts and "Seen" work. If you switch receipts off in Settings, others cannot see it, and you cannot see theirs. Typing bubbles are sent live and never stored.',
    'Reactions, likes and comments: a reaction stores which emoji you picked on which message; a like or comment on a status stores who made it, when, and (for comments) the text. They are deleted with the message, the status or your account.',
    'Replies: a reply stores a link to the message it answers. Notes to yourself are a private chat only you are in, stored like any other messages.',
    'Smart tools: messages you schedule (text, chat and send time) are stored on our servers until they are sent and then removed within 7 days; "send when they come online" checks whether the other person is online and sharing that status, and waits otherwise. Reminders, saved messages and collections, and chats you mark as unread are stored privately and are only visible to you. Search runs inside the database over chats you belong to; results are never shared with anyone else.',
    'Dictation (speak to type) uses your browser\'s own speech recognition. Depending on your browser, your voice may be sent to the browser maker (for example Google or Apple) under their terms; LSDK Chat never receives or stores that audio. Accessibility settings (text size, contrast, motion) stay in your browser.',
    'Ringtones: your ringtone choices and any audio files you add as ringtones are kept only in your browser on your device and are never uploaded.',
    'Calls: we store who called whom (or which group), the type (voice/video), the outcome and the times for 90 days so the Calls list works. During set-up, connection information (which includes network addresses) is exchanged through our database and deleted when the call ends. Because calls are peer-to-peer, the other people in a call can learn your public IP address, and the public STUN servers used (by default Google\'s) see connection requests. When a network blocks direct connections, call audio and video pass through a relay server run by Cloudflare; it only forwards encrypted data and nothing is stored. Audio and video are not stored by us.',
    'Activity data: a "last active" timestamp, refreshed about once a minute while the app is open in a visible browser tab, and your online / last-seen settings.',
    'Technical data: your IP address, browser/device information and timestamps are processed in the server logs of our providers (Supabase and GitHub) when you use the Service or sign in. We do not build profiles from them, but we may look at them to investigate abuse or security problems.',
    'Photos you send are re-saved by your browser before upload, which removes location and camera details (EXIF). Videos, audio, PDFs and text files are uploaded unchanged and may contain such details.',
    'On your device: the sign-in session (an access token) is kept in your browser\'s local storage so you stay signed in, plus your sound, typing-bubble, theme and chat-background choices. A chat background picture you choose stays only in your browser and is never uploaded. We use no advertising or analytics cookies or trackers, and load no third-party fonts, scripts or images.'] },
  { h: '3. Why we use it', ul: [
    'To provide the Service: create your account, authenticate you, deliver messages to the right people (performance of the agreement with you).',
    'To keep the Service safe: rate-limiting, handling reports, investigating abuse, and preventing unauthorised access (our legitimate interests).',
    'To meet legal obligations and respond to lawful requests.',
    'To record that you accepted these documents (your consent / agreement).'] },
  { h: '4. Who can see what', ul: [
    'Other users: your username, bio and profile picture (any signed-in user can find you by searching usernames, view these, start a direct chat with you or add you to a group), and your messages, files and role in rooms you share with them.',
    'Online and last seen: only people who share at least one chat with you can see whether you are online and when you were last active, and only while you leave these switched on in Settings. You can switch off "online" (this also hides last seen) or only "last seen". The database enforces this. If you hide your status you also cannot see other people\'s.',
    'Files you send are kept in a private storage area. Only members of that chat can open them, through temporary links that expire after about an hour. Anyone who has such a link, or who saves the file, can pass it on. Your email address is never shown to other users.',
    'The operator: whoever administers the database can technically read everything stored, including emails, messages and reports. We access message content only for moderation of reports, security, debugging that you ask for, or legal reasons.',
    'Messages are NOT end-to-end encrypted. They are protected in transit (HTTPS/TLS) and by database access rules, but are stored readable on the provider\'s servers.'] },
  { h: '5. Service providers and where data goes', ul: [
    `Supabase (accounts, database, file storage, real-time messaging and sending account emails): data is stored in the region chosen for our project - ${region()}. Support or infrastructure staff of the provider may process it as described in Supabase's own terms and privacy policy.`,
    'GitHub (GitHub Pages hosts the website files): GitHub receives your IP address and request details when you load the site, as described in GitHub\'s privacy statement. Your messages are not sent to GitHub.',
    'Data may therefore be processed outside your country. We do not sell your information, do not show ads, and do not share it with anyone else except where the law compels us to.'] },
  { h: '6. How long we keep it', ul: [
    'Your account, profile, picture, memberships, messages and files are kept until you or a room admin delete them, or you delete your account.',
    'When you delete your account, your account, profile, picture, room memberships, all messages you sent and all files you uploaded are deleted immediately (the app deletes your files first and stops if that fails). Deleting a single message also deletes its file, and when the last member leaves a group its messages and files are deleted. Rooms with no remaining members are deleted. Backups, if any are kept by our provider under the plan in use, expire on the provider\'s schedule.',
    'Abuse reports (with the copied message text and a reference to any file) are kept only as long as needed to handle the report and any follow-up, and may outlive the account of the person who sent or reported the message.',
    'Provider server logs are kept according to the providers\' own policies.'] },
  { h: '7. Your rights', p: ['Depending on where you live you have rights to access, correct, delete, restrict or object to processing of your information, to withdraw consent, and to data portability. You can:'], ul: [
    'download your account details, profile and all messages you have sent (Profile > Download my data, which also includes your status updates and call history; files you uploaded are not inside that download, so save them from the chats first);',
    'change your username, bio and picture (Profile) and your online, last-seen, receipt, status and sound settings (Settings);',
    'delete your account and your messages (Profile > Delete my account);',
    `or contact ${mail()} for anything else, including correcting your email address.`,
    'You may also complain to your data-protection regulator (for example the Information Regulator in South Africa, or your local supervisory authority in the EU/UK). Withdrawing your agreement means you can no longer use the Service.'] },
  { h: '8. Security', p: [
    'We use HTTPS, per-user access rules enforced in the database (Row Level Security), hashed passwords, rate limits and a restrictive content-security policy. No system is perfectly secure; if a breach affects you we will notify you and the regulator as the law requires.'] },
  { h: '9. Children', p: [`The Service is only for people aged ${C.minAge} and over. If we learn that someone under ${C.minAge} has an account we will delete it.`] },
  { h: '10. Changes and contact', p: [`We will update the version number and ask you to accept again when this policy changes materially. Contact: ${mail()}.`] },
]

const DISCLOSURES = () => [
  { h: 'In plain language', p: [`These are the things you should know before using ${C.appName}.`] },
  { h: 'This is a beta', p: ['It may break, change or be wiped at any time. Do not use it for anything important.'] },
  { h: 'Not end-to-end encrypted', p: ['Messages and files are encrypted on the way to and from the server, but the operator (and the hosting provider) can technically read them. Do not share passwords, financial details, ID numbers or other sensitive information.'] },
  { h: 'Who can find and contact you', ul: [
    'Every signed-in user can search usernames, see your username, bio and profile picture, and start a direct chat with you. Do not put anything in your bio or picture that you do not want strangers to see.',
    'People who share a chat with you can see when you are online and when you were last active, unless you turn this off in Settings. If you hide yours, you cannot see theirs.',
    'A group creator can add you to a group without asking first. You can leave a group at any time.',
    'There is currently no block button and direct chats cannot be left. Use Report on a message to alert the operator, or contact the operator to have an account removed.'] },
  { h: 'Calls', ul: [
    'You can call someone only after you have both messaged each other. Inside a group chat, any member can start a group call and every other member is rung. Calls are free.',
    'The people you call can learn your public IP address. A relay server is used when a network blocks direct connections, but a very restrictive network may still fail to connect. Group calls work best with up to 4 people on video (6 on voice).',
    'Calls ring only while the app is open in a browser tab. There is no push notification, so you can miss a call.'] },
  { h: 'Status updates', p: ['Anyone you share a chat with can see your status updates for 24 hours unless you turn sharing off. They can like and comment (comments are private to you and the commenter), and they can save or screenshot them. Reported updates are kept until the operator reviews them.'] },
  { h: 'Moderation is manual and limited', p: ['Reports are read by the operator when they have time. There is no automatic filtering and no guaranteed response time.'] },
  { h: 'Your data', ul: [
    'Stored with Supabase in the region stated in the Privacy Policy; the site files are served by GitHub Pages.',
    'Your sign-in token is kept in this browser\'s local storage. On a shared or public computer, sign out when you finish.',
    'Deleting a message or your account removes it from the live database, but people who already saw a message may have copied it.',
    'Edited messages are not versioned; the previous text is not kept.',
    'Files (up to 20 MB each, at most 300 per person) are not scanned for viruses or illegal content. Photos are cleaned of location data, but videos, audio and documents are not. Anyone in a chat can save a file and share it onwards; deleting it later does not remove copies.',
    'Storage is on a free plan; if it fills up, uploads may stop working.'] },
  { h: 'Service limits', ul: [
    'Runs on free-tier infrastructure: it can be rate-limited, paused after inactivity, or become unavailable.',
    'Account emails (confirmation, password reset) are sent through the provider\'s email service and may be delayed, limited to a few per hour, or land in spam.',
    'Not implemented yet: push notifications (sounds, typing bubbles and call ringing only work while the app is open), blocking, message search, end-to-end encryption.'] },
  { h: 'Open-source software used', p: [
    'The app bundles the Supabase JavaScript client libraries (MIT licence) and their dependencies. The full list with licence texts is in the third-party notices file shipped with the site:'] },
]

const DOCS = {
  terms: { title: 'Terms of Use', body: TERMS },
  privacy: { title: 'Privacy Policy', body: PRIVACY },
  disclosures: { title: 'Important Disclosures', body: DISCLOSURES },
}

export function renderLegal(root, name, signedIn) {
  const doc = DOCS[name]
  const sections = doc.body()
  const nav = ['terms', 'privacy', 'disclosures'].filter((n) => n !== name)
  clear(root).append(h('main', { class: 'doc' },
    h('p', {}, h('a', { href: signedIn ? '#/chat' : '#/login' }, '← Back to the app')),
    h('h1', {}, doc.title),
    h('p', { class: 'small' }, `Version ${TERMS_VERSION} · Operator: ${who()}`),
    !operatorConfigured() && h('div', { class: 'msg error' },
      'Operator details are not filled in yet (src/config.js). This document is incomplete and must not be shown to real users in this state.'),
    sections.map((s) => h('section', {},
      h('h2', {}, s.h),
      (s.p || []).map((t) => h('p', {}, t)),
      s.ul && h('ul', {}, s.ul.map((t) => h('li', {}, t))))),
    name === 'disclosures' && h('p', {}, h('a', { href: './third-party-notices.txt', target: '_blank', rel: 'noopener' }, 'third-party-notices.txt')),
    h('nav', { class: 'legal-foot' }, nav.map((n, i) => [i ? ' · ' : '', h('a', { href: `#/${n}` }, DOCS[n].title)])),
  ))
  window.scrollTo(0, 0)
}
