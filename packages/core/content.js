// @ts-check
/**
 * All game content. Original text. Every outcome is positive — there is no
 * losing state in Your Lucky Day.
 */

/** @typedef {{ id: string, name: string, emoji: string, hue: number, blurb: string }} Charm */

/** @type {Charm[]} */
export const CHARMS = [
  { id: "clover", name: "Clover", emoji: "🍀", hue: 130, blurb: "Small luck that keeps showing up." },
  { id: "star", name: "Star", emoji: "⭐", hue: 45, blurb: "A bright turn when you least expect it." },
  { id: "fish", name: "Fish", emoji: "🐟", hue: 200, blurb: "Go with the current today." },
  { id: "key", name: "Key", emoji: "🗝️", hue: 30, blurb: "Something that was stuck comes loose." },
  { id: "moon", name: "Moon", emoji: "🌙", hue: 260, blurb: "Quiet luck. Rest counts." },
  { id: "acorn", name: "Acorn", emoji: "🌰", hue: 15, blurb: "A tiny start with big roots." },
];

/** Sparkle tiers: name, weight (out of 100), and what it means for the day. */
export const SPARKLES = [
  { id: "bright", name: "Bright day", weight: 70, glyph: "✨", multiplier: 1 },
  { id: "silver", name: "Silver day", weight: 25, glyph: "🌟", multiplier: 2 },
  { id: "golden", name: "Golden day", weight: 5, glyph: "🌞", multiplier: 3 },
];

/** Fortunes: one line, warm, never a prediction that can fail. */
export const FORTUNES = [
  "Something you've been carrying gets lighter today.",
  "A small kindness you did a while ago comes back around.",
  "Today rewards the first step, not the whole staircase.",
  "You'll notice something beautiful that everyone else walks past.",
  "The thing you're dreading is smaller than it looks from here.",
  "Luck today looks like a good conversation.",
  "Someone is glad you exist. They might even say so.",
  "Your timing is better than you think.",
  "A door you thought was closed is only stuck.",
  "Today is a good day to ask.",
  "What you finish today will be enough.",
  "You're allowed to enjoy the easy part.",
  "A tiny yes leads somewhere interesting.",
  "You'll be right about something you were unsure of.",
  "The pause you take today is not wasted.",
  "An ordinary moment turns out to be the good part.",
  "Someone learns something from watching you today.",
  "What you're growing is taking root, even if you can't see it.",
  "Today, being kind to yourself counts as progress.",
  "You'll find the words when you need them.",
  "A little nerve today pays off for weeks.",
  "Your luck today is patient. Let it catch up.",
  "You'll leave a room better than you found it.",
  "One thing goes smoother than expected. Enjoy it.",
  "You're closer than the map suggests.",
  "Today, the shortcut is honesty.",
  "A good idea arrives while you're doing something else.",
  "Something small makes you laugh out loud.",
  "You're about to be someone's good news.",
  "Rest is a lucky move today.",
  "You'll spot the mistake before it matters.",
  "A stranger's good mood is contagious today. Catch it.",
  "The version of you that shows up today is the right one.",
  "Something you say lands exactly right.",
  "You've already done the hard part. Today is the reward.",
  "A little patience turns a no into a not-yet.",
  "You'll remember today for a reason you can't guess yet.",
  "There's more room than you think. Take some.",
  "A plan you'd set aside gets a second wind.",
  "Today, your curiosity is the compass.",
  "You'll get a second chance at a first impression.",
  "Something you fixed stays fixed.",
  "Good news travels toward you today.",
  "You'll be the calm one in the room.",
  "A small risk is the lucky move.",
  "What felt like a detour was the route.",
  "Somebody remembers your name for the right reason.",
  "You'll be surprised by how much you already know.",
  "A quiet hour does more for you than a loud day.",
  "Today, you get to be the lucky coincidence.",
  "The answer is closer to home than you think.",
  "You'll find something you thought was lost.",
  "A little generosity comes back doubled.",
  "Your gut is right today. Trust it once.",
  "The thing you're looking forward to is looking forward to you.",
  "Today's luck: a clear head and an easy heart.",
  "You'll finish the sentence someone else couldn't.",
  "Something you're proud of gets noticed.",
  "The next thing you try works.",
  "You are exactly on time.",
];

/** Lucky moves: one tiny, doable action. */
export const LUCKY_MOVES = [
  "Text someone you haven't talked to in a while.",
  "Say thank you to someone who won't expect it.",
  "Drink a glass of water before your next coffee.",
  "Step outside for five minutes with no phone.",
  "Tidy one surface. Just one.",
  "Give a real compliment to a stranger.",
  "Write down one thing that went right yesterday.",
  "Take the stairs once today.",
  "Leave a kind review for a small business.",
  "Call someone instead of texting.",
  "Let someone merge in front of you.",
  "Learn one new word today.",
  "Eat something green on purpose.",
  "Send a photo to someone who'd love it.",
  "Do the two-minute task you keep skipping.",
  "Hold the door for the person behind you.",
  "Look up. Notice the sky for ten seconds.",
  "Put your phone in another room for an hour.",
  "Tell someone a joke, even a bad one.",
  "Forgive one small thing today.",
  "Stretch for sixty seconds.",
  "Buy the slightly nicer version of one small thing.",
  "Say hi to a neighbor.",
  "Plant, water, or touch something living.",
  "Listen to a song you loved ten years ago.",
  "Make your bed, if it isn't already.",
  "Ask someone how they're really doing, and wait.",
  "Write a three-line note to your future self.",
  "Try the thing on the menu you always skip.",
  "Go to bed fifteen minutes earlier tonight.",
];

/** Community milestones for the shared luck jar (lifetime calls). */
export const MILESTONES = [
  { calls: 100, unlock: "First sprout", emoji: "🌱" },
  { calls: 1_000, unlock: "Little garden", emoji: "🌷" },
  { calls: 10_000, unlock: "Wishing well", emoji: "⛲" },
  { calls: 100_000, unlock: "Lantern grove", emoji: "🏮" },
  { calls: 1_000_000, unlock: "Constellation", emoji: "🌌" },
];
