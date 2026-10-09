import { h, clear } from '../lib/dom.js'
import { CONFIG, isPlaceholder, operatorConfigured } from '../config.js'

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
    'You give us a non-exclusive, worldwide, royalty-free licence to store, process and display your content to the members of the rooms you post in, and to our technical providers, only as needed to run, secure and moderate the Service.',
    'Other members can read, copy and screenshot what you post. We cannot delete copies other people make.',
    'You are responsible for your content and promise you have the right to share it.'] },
  { h: '6. Acceptable use', p: ['You must not use the Service to:'], ul: [
    'break the law or encourage others to, or post content that is unlawful;',
    'harass, threaten, abuse, stalk, defame or discriminate against anyone, or share hateful or violent extremist content;',
    'post sexual content involving minors (we will report this to the authorities), or sexually explicit content;',
    'share other people\'s private information without their permission, or impersonate anyone;',
    'send spam, scams, phishing, malware, or bulk or automated messages;',
    'try to access other people\'s accounts or data, probe or overload the Service, or bypass its limits or security;',
    'create accounts with false details, or create accounts to evade a suspension.'] },
  { h: '7. Reporting and moderation', p: [
    'Every message from another person has a Report option. Reports (including a copy of the reported message) are sent to us and reviewed manually by the operator, who is a person, not a 24/7 moderation team. We may remove content, restrict features, or suspend or delete accounts that break these Terms or put others or the Service at risk. We are not obliged to monitor content and do not promise to act on every report or within a set time.'] },
  { h: '8. Do not share sensitive information', p: [
    'Messages are not end-to-end encrypted. They are stored in readable form on our provider\'s servers and can be accessed by the operator (see the Privacy Policy). Do not send passwords, card or bank details, ID numbers, health information or anything else you would not be comfortable with the operator or a room member seeing.'] },
  { h: '9. Availability and third parties', p: [
    'The Service relies on third-party providers (Supabase for accounts, database, real-time delivery and account emails; GitHub for hosting the web pages). Free plans can be limited, paused or withdrawn, and email delivery may be delayed or restricted. We do not guarantee that the Service will be available, uninterrupted or error-free.'] },
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
    'Account data: your email address, your username, the time the account was created, and which version of the Terms/Privacy Policy you accepted and when. Your password is handled by Supabase Auth and stored only as a salted hash - we cannot see it.',
    'Content you create: messages (text, send time, edit time), room names, which rooms you belong to and your role (admin/member) in them, and any abuse reports you file (including a copy of the reported message).',
    'Technical data: your IP address, browser/device information and timestamps are processed in the server logs of our providers (Supabase and GitHub) when you use the Service or sign in. We do not build profiles from them, but we may look at them to investigate abuse or security problems.',
    'On your device: the sign-in session (an access token) is kept in your browser\'s local storage so you stay signed in. We use no advertising or analytics cookies or trackers, and load no third-party fonts, scripts or images.'] },
  { h: '3. Why we use it', ul: [
    'To provide the Service: create your account, authenticate you, deliver messages to the right people (performance of the agreement with you).',
    'To keep the Service safe: rate-limiting, handling reports, investigating abuse, and preventing unauthorised access (our legitimate interests).',
    'To meet legal obligations and respond to lawful requests.',
    'To record that you accepted these documents (your consent / agreement).'] },
  { h: '4. Who can see what', ul: [
    'Other users: your username (any signed-in user can find you by searching usernames and can start a direct chat with you or add you to a group), and your messages and role in rooms you share with them. Your email address is never shown to other users.',
    'The operator: whoever administers the database can technically read everything stored, including emails, messages and reports. We access message content only for moderation of reports, security, debugging that you ask for, or legal reasons.',
    'Messages are NOT end-to-end encrypted. They are protected in transit (HTTPS/TLS) and by database access rules, but are stored readable on the provider\'s servers.'] },
  { h: '5. Service providers and where data goes', ul: [
    `Supabase (accounts, database, real-time messaging and sending account emails): data is stored in the region chosen for our project - ${region()}. Support or infrastructure staff of the provider may process it as described in Supabase's own terms and privacy policy.`,
    'GitHub (GitHub Pages hosts the website files): GitHub receives your IP address and request details when you load the site, as described in GitHub\'s privacy statement. Your messages are not sent to GitHub.',
    'Data may therefore be processed outside your country. We do not sell your information, do not show ads, and do not share it with anyone else except where the law compels us to.'] },
  { h: '6. How long we keep it', ul: [
    'Your account, profile, memberships and messages are kept until you or a room admin delete them, or you delete your account.',
    'When you delete your account, your account, profile, room memberships and all messages you sent are deleted from the live database immediately. Rooms with no remaining members are deleted. Backups, if any are kept by our provider under the plan in use, expire on the provider\'s schedule.',
    'Abuse reports (with the copied message) are kept only as long as needed to handle the report and any follow-up, and may outlive the account of the person who sent or reported the message.',
    'Provider server logs are kept according to the providers\' own policies.'] },
  { h: '7. Your rights', p: ['Depending on where you live you have rights to access, correct, delete, restrict or object to processing of your information, to withdraw consent, and to data portability. You can:'], ul: [
    'download your account details and all messages you have sent (Profile > Download my data);',
    'change your username (Profile);',
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
  { h: 'Not end-to-end encrypted', p: ['Messages are encrypted on the way to and from the server, but the operator (and the hosting provider) can technically read them. Do not share passwords, financial details, ID numbers or other sensitive information.'] },
  { h: 'Who can find and contact you', ul: [
    'Every signed-in user can search usernames and start a direct chat with you.',
    'A group creator can add you to a group without asking first. You can leave a group at any time.',
    'There is currently no block button and direct chats cannot be left. Use Report on a message to alert the operator, or contact the operator to have an account removed.'] },
  { h: 'Moderation is manual and limited', p: ['Reports are read by the operator when they have time. There is no automatic filtering and no guaranteed response time.'] },
  { h: 'Your data', ul: [
    'Stored with Supabase in the region stated in the Privacy Policy; the site files are served by GitHub Pages.',
    'Your sign-in token is kept in this browser\'s local storage. On a shared or public computer, sign out when you finish.',
    'Deleting a message or your account removes it from the live database, but people who already saw a message may have copied it.',
    'Edited messages are not versioned; the previous text is not kept.'] },
  { h: 'Service limits', ul: [
    'Runs on free-tier infrastructure: it can be rate-limited, paused after inactivity, or become unavailable.',
    'Account emails (confirmation, password reset) are sent through the provider\'s email service and may be delayed, limited to a few per hour, or land in spam.',
    'Not implemented yet: push notifications, file or image sharing, read receipts, blocking, message search. "New message" markers only last while the page stays open.'] },
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
    h('p', { class: 'small' }, `Version ${C.termsVersion} · Operator: ${who()}`),
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
