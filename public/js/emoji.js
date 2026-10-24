// Keyword-searchable emoji set (kept small: the common ~200). Search "happy", "love", "pray"…
import { h } from './ui.js';

const RAW = `😀 grin happy smile joy glad
😃 smiley happy joy grin
😄 smile happy laugh joy
😁 beam grin happy teeth
😆 laugh lol happy haha
😅 sweat relief nervous laugh
😂 joy tears laugh lol funny cry
🤣 rofl rolling laugh lol funny
🙂 slight smile happy ok
😉 wink flirt joke
😊 blush happy smile shy warm
😇 angel innocent halo blessed
🥰 love hearts adore happy crush
😍 heart eyes love crush amazing
🤩 star struck wow amazing excited
😘 kiss love blow
😋 yum delicious tasty food
😛 tongue playful silly
😜 wink tongue crazy silly
🤪 zany crazy goofy silly
🤗 hug hugs welcome warm
🤭 giggle oops hand mouth
🤫 shh quiet secret silence
🤔 think hmm wonder question
🤐 zip quiet secret
😐 neutral meh blank
😑 expressionless meh
😶 speechless silent
😏 smirk sly
😒 unamused meh annoyed
🙄 eye roll whatever annoyed
😬 grimace awkward yikes
😌 relieved calm peace content
😔 pensive sad down
😪 sleepy tired
😴 sleep tired zzz bored
😷 mask sick ill
🤒 sick fever ill
🤯 mind blown shocked wow
🥳 party celebrate birthday happy
😎 cool sunglasses awesome
🤓 nerd geek smart
🧐 monocle curious inspect
😕 confused unsure
😟 worried concern
🙁 frown sad
😮 wow surprised open mouth
😲 astonished shocked wow
🥺 pleading puppy please beg
😢 cry sad tear
😭 sob cry sad tears
😱 scream fear shocked scared
😖 confounded frustrated
😞 disappointed sad
😓 sweat tired stress
😩 weary tired
😫 tired exhausted
🥱 yawn bored tired
😤 triumph huff proud determined
😡 angry mad rage
😠 angry mad annoyed
🤬 cursing swear angry
💀 skull dead lol dying
💩 poop
🤡 clown silly
👻 ghost boo spooky
👽 alien
🤖 robot bot ai
😺 cat smile happy
❤️ heart love red
🧡 orange heart love
💛 yellow heart love friendship
💚 green heart love
💙 blue heart love
💜 purple heart love
🖤 black heart
🤍 white heart love pure
💔 broken heart sad
❣️ heart exclamation love
💕 two hearts love
💞 revolving hearts love
💖 sparkling heart love
💯 hundred perfect score agree
💢 anger angry
💥 boom collision explode
💫 dizzy star
💦 sweat drops
💨 dash fast wind
🕊️ dove peace spirit holy
👋 wave hello hi bye greeting
🤚 raised back hand
✋ hand stop high five
🖐️ hand fingers
👌 ok perfect fine
✌️ peace victory
🤞 crossed fingers luck hope
🤟 love you
🤘 rock on metal
🤙 call me shaka
👈 left point
👉 right point
👆 up point
👇 down point
☝️ one point up
👍 thumbs up like yes agree good ok
👎 thumbs down dislike no bad
✊ fist solidarity
👊 punch fist bump
👏 clap applause bravo well done
🙌 raise hands praise hooray celebrate hallelujah
👐 open hands
🤲 palms up pray dua offer
🤝 handshake deal agree partner
🙏 pray please thanks amen grateful hope
✍️ write note
💪 strong muscle power flex
🧠 brain smart think
👀 eyes look watch see
👂 ear listen hear
🗣️ speak talk voice
👶 baby
👨‍👩‍👧 family
🧑‍🏫 teacher
🎤 mic sing karaoke speak
🎧 headphones music listen
🎵 music note song
🎶 music notes song worship
🎹 piano keys music
🥁 drum music
🎸 guitar music
🎺 trumpet music
🎉 tada party celebrate congrats hooray
🎊 confetti party celebrate
🎈 balloon party birthday
🎁 gift present
🎂 cake birthday
🏆 trophy win champion award
🥇 gold medal first win
⭐ star favourite great
🌟 glowing star shine
✨ sparkles magic new shine
🔥 fire lit hot amazing
⚡ lightning zap power energy
🌈 rainbow hope
☀️ sun sunny day
🌙 moon night
☁️ cloud
🌧️ rain
❄️ snow cold
🌍 world earth globe africa
🌸 blossom flower spring
🌹 rose flower love
🌻 sunflower flower
🌱 seedling grow new plant
🍀 clover luck
🍕 pizza food
🍔 burger food
🍟 fries food
🍗 chicken food
🍚 rice food jollof
🍲 stew pot food soup
🥗 salad food healthy
🍰 cake dessert
🍩 donut dessert
☕ coffee tea drink morning
🍵 tea drink
🥤 drink soda
🍾 champagne celebrate
🥂 cheers toast celebrate
⚽ football soccer ball sport
🏀 basketball sport
🎮 game play controller
🚀 rocket launch ship fast
✈️ plane travel flight
🚗 car drive
🏠 home house
⛪ church worship
🕌 mosque worship
📖 book bible read study scripture
📚 books study library
📝 memo note write
📌 pin
📎 paperclip attach
📣 megaphone announce
📢 loudspeaker announce
🔔 bell notify ding
💡 idea bulb light
💻 laptop computer work
📱 phone mobile
📷 camera photo
🎥 movie camera video film
📺 tv
⏰ alarm clock time
⏳ hourglass wait time
✅ check done yes complete
☑️ check box done
✔️ check mark done
❌ cross no wrong cancel
❓ question
❗ exclamation important
⚠️ warning caution
🚫 prohibited no
➕ plus add
💬 speech chat message comment
💭 thought bubble think
🗨️ speech
👑 crown king queen royal
💎 gem diamond precious
💰 money bag rich
💵 money cash dollar naira
🙋 raise hand question me
🙇 bow sorry thanks
🤷 shrug dunno whatever
🤦 facepalm ugh
💃 dance party happy woman
🕺 dance party happy man
🚶 walk
🏃 run fast
🧘 meditate calm peace
😇 blessed grace
✝️ cross faith jesus christian
🛐 worship pray place
🇳🇬 nigeria flag naija`;

export const EMOJI = RAW.split('\n').map((l) => { const [e, ...k] = l.trim().split(/\s+/); return { e, k }; }).filter((x, i, a) => x.e && a.findIndex((y) => y.e === x.e) === i);
export const QUICK = ['👍', '❤️', '😂', '👏', '🎉', '🙏', '🔥', '😮', '💯', '🙌'];

/** Keyword search: "happy" → 😀😃😄… Prefix matches on any keyword rank first. */
export function searchEmoji(q, limit = 40) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return EMOJI.slice(0, limit).map((x) => x.e);
  const out = [];
  for (const x of EMOJI) {
    let s = 0;
    for (const k of x.k) { if (k === q) s = Math.max(s, 3); else if (k.startsWith(q)) s = Math.max(s, 2); else if (q.length > 2 && k.includes(q)) s = Math.max(s, 1); }
    if (s) out.push([s, x.e]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}
export const emojiName = (e) => (EMOJI.find((x) => x.e === e)?.k[0]) || 'emoji';

const RECENT_KEY = 'venue.emoji.recent';
export const recentEmoji = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
export function pushRecent(e) { const r = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 16); localStorage.setItem(RECENT_KEY, JSON.stringify(r)); return r; }

/** Small searchable popover anchored above an element. onPick(emoji). */
export function emojiPopover(anchor, onPick, { keepOpen = false } = {}) {
  const open = document.querySelector('.emoji-pop');
  if (open) { open._close?.(); if (open._anchor === anchor) return null; }
  const input = h('input', { class: 'emoji-search', type: 'search', placeholder: 'Search emoji — happy, pray, fire…', 'aria-label': 'Search emoji' });
  const grid = h('div', { class: 'emoji-grid', role: 'listbox' });
  const pop = h('div', { class: 'emoji-pop', role: 'dialog', 'aria-label': 'Emoji' }, input, grid);
  const paint = () => {
    const q = input.value; const rec = q ? [] : recentEmoji();
    const list = q ? searchEmoji(q, 64) : [...new Set([...rec, ...QUICK, ...EMOJI.map((x) => x.e)])].slice(0, 96);
    grid.replaceChildren(...(list.length ? list.map((e) => h('button', { type: 'button', class: 'emoji-cell', title: emojiName(e), 'aria-label': emojiName(e), onclick: () => { pushRecent(e); onPick(e); if (!keepOpen) close(); } }, e)) : [h('p', { class: 'tiny muted', style: { gridColumn: '1/-1', padding: '.6rem' } }, `No emoji for “${q}”`)]));
  };
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = grid.querySelector('.emoji-cell'); if (f) { e.preventDefault(); f.click(); } } if (e.key === 'Escape') close(); });
  paint();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const W = Math.min(320, innerWidth - 16);
  pop.style.width = W + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - W - 8, r.left)) + 'px';
  pop.style.bottom = Math.max(8, innerHeight - r.top + 8) + 'px';
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  function close() { pop.remove(); document.removeEventListener('pointerdown', away, true); }
  pop._anchor = anchor; pop._close = close;
  setTimeout(() => document.addEventListener('pointerdown', away, true));
  if (matchMedia('(pointer:fine)').matches) input.focus();
  return { close, el: pop };
}
