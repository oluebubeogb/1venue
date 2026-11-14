/**
 * Demo content for the seed. Images are hot-linked from Unsplash (free to use under the
 * Unsplash License, https://unsplash.com/license); YouTube materials are public TED/Stanford talks.
 * Everything here is fictional: names, phone numbers and stories are made up.
 */
const img = (id, w = 1200, h = 0) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ''}&q=80`;
const face = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&crop=faces&w=400&h=400&q=80`;

const PASSWORD = '@1venued';
const EMAIL_DOMAIN = 'seed.1venue.live';

// key, display name, username, avatar, bio, phone, prefs
const USERS = [
  ['adaeze', 'Adaeze Okafor', 'adaeze', face('1531123897727-8f129e1688ce'), 'Worship leader and choir director in Enugu. I host Sunday Praise Night and a midweek Bible study on 1venue. 🎶', '+2348000000101', { theme: 'light', accent: '#e11d48', accent2: '#f59e0b', bible: 'ibo_bib' }],
  ['chinedu', 'Chinedu Eze', 'chinedu.eze', face('1531384441138-2736e62e0919'), 'Product designer in Lagos. I run Lagos Design Circle, hands-on Figma workshops for new designers.', '+2348000000102', { theme: 'dark', accent: '#7c3aed', accent2: '#db2777', bible: 'eng_kjv' }],
  ['ibrahim', 'Ibrahim Musa', 'ibrahim.musa', face('1506277886164-e25aa3f4ef7f'), 'Qur’an teacher in Kano. Weekly tafsir circle every Friday after Jumu’ah, in Hausa and English.', '+2348000000103', { theme: 'system', accent: '#059669', accent2: '#0891b2', bible: 'hau_bib', quran: 'quran_en_sahih' }],
  ['tobi', 'Tobi Alade', 'tobi.alade', face('1522529599102-193c0d76b5b6'), 'Host of Naija Tech Talk: candid conversations with the people building Africa’s internet.', '+2348000000104', { theme: 'dark', accent: '#2563eb', accent2: '#7c3aed', bible: 'eng_kjv' }],
  ['ngozi', 'Ngozi Ike', 'ngozi.ike', face('1507152832244-10d45c7eda57'), 'Data scientist and mentor. I teach Python for Beginners live every Saturday morning.', '+2348000000105', { theme: 'light', accent: '#0d9488', accent2: '#2563eb', bible: 'ENGWEBP' }],
  ['emeka', 'Emeka Obi', 'emeka.obi', face('1543610892-0b1f7e6d8ac1'), 'Afrobeats producer and guitarist. Live studio jams from Surulere, Lagos.', '+2348000000106', { theme: 'dark', accent: '#ea580c', accent2: '#e11d48', bible: 'eng_kjv' }],
  ['aisha', 'Aisha Bello', 'aisha.bello', face('1488426862026-3ee34a7d66df'), 'Founder of a fashion label in Abuja. I host the Women in Business webinar series.', '+2348000000107', { theme: 'light', accent: '#db2777', accent2: '#7c3aed', bible: 'eng_kjv', quran: 'quran_en_sahih' }],
  ['sarah', 'Sarah Mensah', 'sarah.mensah', face('1520813792240-56fc4a3765a7'), 'Product lead, Accra ↔ London. Seminars on product strategy and storytelling.', '+2348000000108', { theme: 'system', accent: '#334155', accent2: '#2563eb', bible: 'ENGWEBP' }],
  ['yusuf', 'Yusuf Abdullahi', 'yusuf.abdullahi', face('1557862921-37829c790f19'), 'Community organiser in Kano. Town halls on youth jobs, grants and civic tech.', '+2348000000109', { theme: 'light', accent: '#b7791f', accent2: '#ea580c', bible: 'hau_bib', quran: 'quran_ar_uthmani' }],
  ['funke', 'Funke Adeyemi', 'funke.adeyemi', face('1567532939604-b6b5b0db2604'), 'Startup coach. I help founders tell their story in ten slides. Pitch masterclasses monthly.', '+2348000000110', { theme: 'light', accent: '#7c3aed', accent2: '#2563eb', bible: 'eng_kjv' }],
].map(([key, name, username, avatar, bio, phone, prefs]) => ({ key, name, username, avatar, bio, phone, prefs, email: `${username.replace(/\./g, '')}@${EMAIL_DOMAIN}` }));

const COVERS = {
  audience: img('1540575467063-178a50c2df87'), stage: img('1475721027785-f74eccf877e2'), presentation: img('1505373877841-8d25f7d46678'),
  hall: img('1511578314322-379afb476865'), worship: img('1438232992991-995b7058bbb3'), praise: img('1507692049790-de58290a4334'),
  concert: img('1501281668745-f7f57925c3b4'), lights: img('1514525253161-7a46d19cd819'), seminar: img('1524178232363-1fb2b075b655'),
  study: img('1522202176988-66273c2fd55f'), workshop: img('1552664730-d307ca884978'), meeting: img('1517048676732-d65bc937f952'),
  webinar: img('1588196749597-9ff075ee6b5b'), podcast: img('1478737270239-2f02b77fc618'), mic: img('1590602847861-f357a9332bbc'),
  quran: img('1609599006353-e629aaabfeae'), kaaba: img('1564769625905-50e93615e769'), students: img('1531482615713-2afd69097998'),
  confetti: img('1492684223066-81342ee5ff30'), crowd: img('1470229722913-7c0e2dbbafd3'), friends: img('1529156069898-49953e39b3ac'),
  reading: img('1491841550275-ad7854e35ca6'), laptop: img('1573164713714-d95e436ab8d6'), notes: img('1529070538774-1843cb3265df'),
  sunset: img('1506869640319-fe1a24fd76dc'), desks: img('1519389950473-47ba0277781c'), community: img('1528605248644-14dd04022da1'),
  group: img('1543269865-cbf427effbad'), team: img('1544027993-37dbfe43562a'),
};

// host, title, category, cover, language, tags, days from now (negative = past), hours long, speakers, description
const EVENTS = [
  ['adaeze', 'Sunday Praise Night: Igbo & English Worship', 'sermon', 'praise', 'ig', ['worship', 'praise', 'igbo'], 2, 2, ['emeka'], 'An evening of worship songs in Igbo and English with the Grace Chapel choir. Bring your requests. We will read Psalm 100 together.'],
  ['ibrahim', 'Friday Tafsir Circle: Surah Al-Kahf', 'class', 'quran', 'ha', ['quran', 'tafsir', 'hausa'], 5, 1.5, ['yusuf'], 'We read Surah Al-Kahf together and reflect on the story of the people of the cave. Hausa with English notes. All are welcome.'],
  ['tobi', 'Naija Tech Talk: Building for 200 Million Users', 'talk_show', 'podcast', 'en', ['tech', 'startups', 'africa'], 3, 1.5, ['sarah', 'chinedu'], 'Product, payments and infrastructure lessons from teams shipping to every corner of Nigeria. Live Q&A at the end.'],
  ['chinedu', 'Lagos Design Circle: From Figma to Prototype', 'workshop', 'workshop', 'en', ['design', 'figma', 'ux'], 6, 2, ['funke'], 'A hands-on session: we take one screen from sketch to a clickable prototype. Bring a laptop and a free Figma account.'],
  ['ngozi', 'Python for Beginners: Week 4 (Loops & Lists)', 'class', 'students', 'en', ['python', 'coding', 'beginners'], 1, 1.5, [], 'This week: for-loops, lists and a tiny project that counts words in a Bible chapter. Recording and notes shared afterwards.'],
  ['emeka', 'Studio Session: Afrobeats Live Jam', 'concert', 'lights', 'en', ['music', 'afrobeats', 'live'], 4, 2, ['adaeze'], 'Live from the studio: guitar, talking drum and keys. Request a song in the chat and watch it come together.'],
  ['aisha', 'Women in Business: Pricing with Confidence', 'webinar', 'laptop', 'en', ['business', 'women', 'pricing'], 8, 1, ['funke'], 'How to set prices that respect your work. Worksheets, real examples from Abuja and Lagos small businesses, and open Q&A.'],
  ['sarah', 'Product Strategy Seminar: Saying No Well', 'seminar', 'seminar', 'en', ['product', 'strategy', 'leadership'], 10, 1.5, ['tobi'], 'A practical seminar on roadmaps, trade-offs and the art of a kind, clear "no". Slides and a reading list included.'],
  ['yusuf', 'Kano Youth Fund Town Hall', 'meeting', 'community', 'ha', ['community', 'grants', 'kano'], 7, 1.5, ['ibrahim'], 'Open town hall about the new youth micro-grant: who can apply, how judging works, and your questions. Hausa and English.'],
  ['funke', 'Pitch Deck Masterclass: Ten Slides That Raise', 'presentation', 'presentation', 'en', ['pitch', 'startups', 'fundraising'], 9, 1.5, ['aisha'], 'We rebuild three real pitch decks live and explain every change. Founders can submit a deck for review.'],
  // past events (with a full session record)
  ['adaeze', 'Midweek Bible Study: Psalm 23', 'sermon', 'reading', 'en', ['bible', 'psalms', 'study'], -3, 1, [], 'A quiet hour in Psalm 23: the Lord is my shepherd. Reading, reflection and prayer requests.'],
  ['tobi', 'Naija Tech Talk: Fintech After Cashless', 'talk_show', 'stage', 'en', ['fintech', 'payments', 'tech'], -7, 1.5, ['sarah'], 'What the cashless policy taught founders about trust, agents and offline payments.'],
  ['ngozi', 'Python for Beginners: Week 3 (Variables)', 'class', 'notes', 'en', ['python', 'coding', 'beginners'], -6, 1.5, [], 'Variables, strings and input(). We wrote a greeting program in English, Igbo and Hausa.'],
  ['ibrahim', 'Tajweed Basics for Beginners', 'class', 'kaaba', 'ar', ['quran', 'tajweed', 'arabic'], -10, 1, [], 'The makharij (points of articulation) and the rules of noon saakinah, with live recitation practice.'],
];

// author, body, image cover key or null, days ago
const POSTS = [
  ['adaeze', 'Choir rehearsal tonight was something else. Sunday Praise Night is going to be special. Who is joining us? 🙌', 'worship', 1],
  ['adaeze', 'Thank you to everyone who came to Bible study. Here is the verse we closed with.', null, 3, { type: 'passage', reference: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.', translation: 'eng_kjv', short: 'KJV' }],
  ['chinedu', 'Workshop prep: 40 sticky notes, 3 markers, 1 very patient whiteboard. See you Saturday, designers.', 'workshop', 2],
  ['chinedu', 'Design tip: if you have to explain a button, it is not the button’s fault, it is the label’s.', null, 5],
  ['ibrahim', 'Our Friday circle continues with Surah Al-Kahf. Reading the first ten ayahs is a beautiful habit.', 'quran', 1, { type: 'passage', reference: 'Al-Ikhlas 1-4', text: 'Say, "He is Allah, [who is] One, Allah, the Eternal Refuge. He neither begets nor is born, nor is there to Him any equivalent."', translation: 'quran_en_sahih', short: 'Sahih' }],
  ['tobi', 'Last week’s fintech episode is up as a session recap. Huge thanks to Sarah for the sharp questions.', 'stage', 6],
  ['tobi', 'Hot take: the best Nigerian products are built for bad network days, not good ones.', null, 2],
  ['ngozi', 'Week 3 homework is in. So proud of this class: 31 people wrote their first Python program! 🐍', 'notes', 5],
  ['ngozi', 'Saturday’s lesson: loops. Bring a chapter of your favourite book; we will count its words together.', 'study', 1],
  ['emeka', 'New beat cooking in the studio. Talking drum + highlife guitar. Live jam on Thursday.', 'concert', 2],
  ['aisha', 'Pricing is a story you tell about your value. Webinar next week, and the worksheet is free for all attendees.', 'laptop', 3],
  ['sarah', 'Reading list for the product seminar: Inspired, Escaping the Build Trap, and The Mom Test.', 'seminar', 4],
  ['yusuf', 'Town hall next week on the Kano Youth Fund. Bring your questions, and bring a friend who should apply.', 'community', 2],
  ['funke', 'Your pitch deck has one job: get the next meeting. Masterclass slots are open.', 'presentation', 3],
  ['funke', 'Great energy at the founders’ meetup today. Africa is building. 🚀', 'team', 6],
];

const COMMENTS = [
  'This is beautiful 🙏', 'Count me in!', 'So helpful, thank you.', 'Saving this for later.', 'Can’t wait for this one.',
  'Brilliant session, learnt a lot.', 'Will the recording be shared?', 'Amen!', 'This is exactly what I needed today.', 'See you there 👋',
];

// owner, title, YouTube id (public talks), attach to event title (prefix match)
const MATERIALS = [
  ['sarah', 'The Danger of a Single Story — Chimamanda Ngozi Adichie (TED)', 'D9Ihs241zeg', 'Product Strategy Seminar'],
  ['ngozi', 'Grit: The Power of Passion and Perseverance (TED)', 'H14bBuluwB8', 'Python for Beginners: Week 4'],
  ['chinedu', 'Inside the Mind of a Master Procrastinator (TED)', 'arj7oStGLkU', 'Lagos Design Circle'],
  ['funke', 'Steve Jobs’ 2005 Stanford Commencement Address', 'UF8uR6Z6KLc', 'Pitch Deck Masterclass'],
  ['aisha', 'The Power of Vulnerability — Brené Brown (TED)', 'iCvmsMzlF7o', 'Women in Business'],
];

// Past sessions: event title prefix -> chat, poll, questions, transcript, summary
const SESSIONS = {
  'Midweek Bible Study': {
    chat: [['ngozi', 'Good evening everyone 🙏'], ['funke', 'Joining from Ibadan!'], ['adaeze', 'Welcome! We start with Psalm 23:1 in a moment.'], ['emeka', 'Amen. Please pray for my mum’s recovery.']],
    poll: ['Which verse spoke to you most?', ['Verse 1: The Lord is my shepherd', 'Verse 4: Though I walk through the valley', 'Verse 6: Goodness and mercy']],
    questions: [['funke', 'What does “restoreth my soul” mean in everyday life?', 'It means God brings us back to life and strength when we are worn out.']],
    transcript: [['adaeze', 'Welcome everyone to midweek Bible study. Tonight we are in Psalm twenty-three.'], ['adaeze', 'The Lord is my shepherd; I shall not want. Notice that David starts with trust, not with a request.'], ['ngozi', 'I love that. It changes how I read verse four.']],
    summary: '## Summary\n- Read Psalm 23 together in English and Igbo.\n- Theme: trust comes before requests (verse 1).\n- Prayer requests collected for health and exams.\n\n## Action items\n- Memorise Psalm 23:1–3 before next week.',
  },
  'Naija Tech Talk: Fintech': {
    chat: [['chinedu', 'The offline payments point is so real.'], ['sarah', 'Agents are the real infrastructure.'], ['yusuf', 'Greetings from Kano 👋'], ['tobi', 'Drop your questions in Q&A, we will take them at the end.']],
    poll: ['How do you pay for things most often?', ['Bank transfer', 'Card', 'Cash', 'USSD']],
    questions: [['yusuf', 'How do small traders build trust with new payment apps?', 'Agents and instant reversals. People trust a face they know and money they can get back.'], ['chinedu', 'Is USSD still worth building for?', 'Yes. Millions still use feature phones, and USSD works on bad network days.']],
    transcript: [['tobi', 'Welcome to Naija Tech Talk. Today we are talking fintech after the cashless policy.'], ['sarah', 'The big lesson was trust. When cash disappeared, people needed instant reversals.'], ['tobi', 'And agents became the front line of every payments company.']],
    summary: '## Summary\n- Cashless policy pushed transfers and agents to the front.\n- Trust drivers: instant reversals, familiar agents, clear SMS receipts.\n- USSD remains essential for feature-phone users.\n\n## Action items\n- Episode recap posted to the feed.',
  },
  'Python for Beginners: Week 3': {
    chat: [['funke', 'My first program works!!'], ['chinedu', 'print("Ndewo") 😄'], ['ngozi', 'Perfect! Now try input() for the name.']],
    poll: ['How confident do you feel with variables now?', ['Very confident', 'Getting there', 'Still confused']],
    questions: [['emeka', 'What is the difference between = and ==?', 'One equals sign stores a value; two compare values and give True or False.']],
    transcript: [['ngozi', 'A variable is a labelled box. name equals Ngozi puts my name in the box.'], ['ngozi', 'Now let us greet in three languages: Hello, Ndewo, Sannu.']],
    summary: '## Summary\n- Variables, strings and input().\n- Built a greeting program in English, Igbo and Hausa.\n\n## Homework\n- Ask for a name and a city, then print a sentence with both.',
  },
  'Tajweed Basics': {
    chat: [['yusuf', 'As-salamu alaykum everyone'], ['aisha', 'Wa alaykum as-salam 🌙'], ['ibrahim', 'We begin with the makharij of the throat letters.']],
    poll: ['Which rule should we practise next week?', ['Idgham', 'Ikhfa', 'Iqlab']],
    questions: [['aisha', 'How long should a natural madd be held?', 'Two counts, about the time it takes to open or close a finger twice.']],
    transcript: [['ibrahim', 'Today we learn where each letter comes from: the throat, the tongue and the lips.'], ['ibrahim', 'Listen carefully to the difference between ح and ه.']],
    summary: '## Summary\n- Points of articulation (makharij).\n- Rules of noon saakinah and tanween.\n\n## Practice\n- Recite Al-Fatihah daily with attention to madd.',
  },
};

// DMs: [a, b, [[sender, body], ...]]
const DMS = [
  ['tobi', 'sarah', [['tobi', 'Thanks again for joining the show!'], ['sarah', 'Anytime. Next time let’s do product + payments.'], ['tobi', 'Deal. I’ll send a date.']]],
  ['adaeze', 'emeka', [['adaeze', 'Can you play guitar for Sunday Praise Night?'], ['emeka', 'Yes! Send me the song list 🎸']]],
  ['ngozi', 'chinedu', [['chinedu', 'Your Python class is so good. Can I share the notes with my team?'], ['ngozi', 'Of course, they are public on my profile.']]],
  ['ibrahim', 'yusuf', [['yusuf', 'Will you open the town hall with a short dua?'], ['ibrahim', 'In shaa Allah, I will be there.']]],
  ['funke', 'aisha', [['funke', 'Your pricing worksheet is brilliant.'], ['aisha', 'Thank you! Shall we co-host in December?']]],
];

const VENUES = [['adaeze', 'Grace Chapel Live', ['emeka']], ['ibrahim', 'Friday Tafsir Room', ['yusuf']], ['tobi', 'Naija Tech Talk Studio', ['sarah']]];

const WHITEBOARDS = [
  ['chinedu', 'Prototype flow', 'Sketch → Wireframe → Prototype → Test'],
  ['ngozi', 'Python loops', 'for word in words:\n    count += 1'],
  ['sarah', 'Roadmap trade-offs', 'Impact ↑  Effort →'],
];

module.exports = { PASSWORD, EMAIL_DOMAIN, USERS, COVERS, EVENTS, POSTS, COMMENTS, MATERIALS, SESSIONS, DMS, VENUES, WHITEBOARDS, img };
