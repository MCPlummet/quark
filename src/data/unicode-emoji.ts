// AUTO-GENERATED — do not edit by hand.
// Regenerate with: pnpm gen:emoji
// Source: emojibase-data 17.0.0 (github shortcode preset).
// 1914 emoji across 9 categories.

import type { ShortcodeEntry } from "../ui/ShortcodePreview.js";

export interface EmojiDataEntry {
  /** Primary shortcode, e.g. "thumbsup". */
  shortcode: string;
  /** Unicode glyph. */
  glyph: string;
  /** Search keywords (Unicode CLDR tags). */
  keywords?: string[];
  /** Alternate shortcodes, e.g. "+1" for "thumbsup". */
  aliases?: string[];
}

export interface EmojiCategory {
  id: string;
  /** Emoji glyph used as the category button icon. */
  icon: string;
  name: string;
  entries: EmojiDataEntry[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    "id": "smileys",
    "icon": "😀",
    "name": "Smileys & Emotion",
    "entries": [
      {
        "shortcode": "grinning",
        "glyph": "😀",
        "keywords": [
          "cheerful",
          "cheery",
          "face",
          "grin",
          "grinning",
          "happy",
          "laugh",
          "nice",
          "smile",
          "smiling",
          "teeth"
        ],
        "aliases": [
          "grinning_face"
        ]
      },
      {
        "shortcode": "smiley",
        "glyph": "😃",
        "keywords": [
          "awesome",
          "big",
          "eyes",
          "face",
          "grin",
          "grinning",
          "happy",
          "mouth",
          "open",
          "smile",
          "smiling",
          "teeth",
          "yay"
        ],
        "aliases": [
          "grinning_face_with_big_eyes"
        ]
      },
      {
        "shortcode": "smile",
        "glyph": "😄",
        "keywords": [
          "eye",
          "eyes",
          "face",
          "grin",
          "grinning",
          "happy",
          "laugh",
          "lol",
          "mouth",
          "open",
          "smile",
          "smiling"
        ],
        "aliases": [
          "grinning_face_with_closed_eyes"
        ]
      },
      {
        "shortcode": "grin",
        "glyph": "😁",
        "keywords": [
          "beaming",
          "eye",
          "eyes",
          "face",
          "grin",
          "grinning",
          "happy",
          "nice",
          "smile",
          "smiling",
          "teeth"
        ],
        "aliases": [
          "beaming_face"
        ]
      },
      {
        "shortcode": "laughing",
        "glyph": "😆",
        "keywords": [
          "closed",
          "eyes",
          "face",
          "grinning",
          "haha",
          "hahaha",
          "happy",
          "laugh",
          "lol",
          "mouth",
          "open",
          "rofl",
          "smile",
          "smiling",
          "squinting"
        ],
        "aliases": [
          "satisfied",
          "lol",
          "squinting_face"
        ]
      },
      {
        "shortcode": "sweat_smile",
        "glyph": "😅",
        "keywords": [
          "cold",
          "dejected",
          "excited",
          "face",
          "grinning",
          "mouth",
          "nervous",
          "open",
          "smile",
          "smiling",
          "stress",
          "stressed",
          "sweat"
        ],
        "aliases": [
          "grinning_face_with_sweat"
        ]
      },
      {
        "shortcode": "rofl",
        "glyph": "🤣",
        "keywords": [
          "crying",
          "face",
          "floor",
          "funny",
          "haha",
          "happy",
          "hehe",
          "hilarious",
          "joy",
          "laugh",
          "lmao",
          "lol",
          "rofl",
          "roflmao",
          "rolling",
          "tear"
        ]
      },
      {
        "shortcode": "joy",
        "glyph": "😂",
        "keywords": [
          "crying",
          "face",
          "feels",
          "funny",
          "haha",
          "happy",
          "hehe",
          "hilarious",
          "joy",
          "laugh",
          "lmao",
          "lol",
          "rofl",
          "roflmao",
          "tear"
        ],
        "aliases": [
          "lmao",
          "tears_of_joy"
        ]
      },
      {
        "shortcode": "slightly_smiling_face",
        "glyph": "🙂",
        "keywords": [
          "face",
          "happy",
          "slightly",
          "smile",
          "smiling"
        ]
      },
      {
        "shortcode": "upside_down_face",
        "glyph": "🙃",
        "keywords": [
          "face",
          "hehe",
          "smile",
          "upside-down"
        ]
      },
      {
        "shortcode": "melting_face",
        "glyph": "🫠",
        "keywords": [
          "disappear",
          "dissolve",
          "embarrassed",
          "face",
          "haha",
          "heat",
          "hot",
          "liquid",
          "lol",
          "melt",
          "melting",
          "sarcasm",
          "sarcastic"
        ],
        "aliases": [
          "melt"
        ]
      },
      {
        "shortcode": "wink",
        "glyph": "😉",
        "keywords": [
          "face",
          "flirt",
          "heartbreaker",
          "sexy",
          "slide",
          "tease",
          "wink",
          "winking",
          "winks"
        ],
        "aliases": [
          "winking_face"
        ]
      },
      {
        "shortcode": "blush",
        "glyph": "😊",
        "keywords": [
          "blush",
          "eye",
          "eyes",
          "face",
          "glad",
          "satisfied",
          "smile",
          "smiling"
        ],
        "aliases": [
          "smiling_face_with_closed_eyes"
        ]
      },
      {
        "shortcode": "innocent",
        "glyph": "😇",
        "keywords": [
          "angel",
          "angelic",
          "angels",
          "blessed",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "halo",
          "happy",
          "innocent",
          "peaceful",
          "smile",
          "smiling",
          "spirit",
          "tale"
        ],
        "aliases": [
          "halo"
        ]
      },
      {
        "shortcode": "smiling_face_with_three_hearts",
        "glyph": "🥰",
        "keywords": [
          "3",
          "adore",
          "crush",
          "face",
          "heart",
          "hearts",
          "ily",
          "love",
          "romance",
          "smile",
          "smiling",
          "you"
        ],
        "aliases": [
          "smiling_face_with_3_hearts"
        ]
      },
      {
        "shortcode": "heart_eyes",
        "glyph": "😍",
        "keywords": [
          "143",
          "bae",
          "eye",
          "face",
          "feels",
          "heart-eyes",
          "hearts",
          "ily",
          "kisses",
          "love",
          "romance",
          "romantic",
          "smile",
          "xoxo"
        ],
        "aliases": [
          "smiling_face_with_heart_eyes"
        ]
      },
      {
        "shortcode": "star_struck",
        "glyph": "🤩",
        "keywords": [
          "excited",
          "eyes",
          "face",
          "grinning",
          "smile",
          "star",
          "starry-eyed",
          "wow"
        ]
      },
      {
        "shortcode": "kissing_heart",
        "glyph": "😘",
        "keywords": [
          "adorbs",
          "bae",
          "blowing",
          "face",
          "flirt",
          "heart",
          "ily",
          "kiss",
          "love",
          "lover",
          "miss",
          "muah",
          "romantic",
          "smooch",
          "xoxo",
          "you"
        ],
        "aliases": [
          "blowing_a_kiss"
        ]
      },
      {
        "shortcode": "kissing",
        "glyph": "😗",
        "keywords": [
          "143",
          "date",
          "dating",
          "face",
          "flirt",
          "ily",
          "kiss",
          "love",
          "smooch",
          "smooches",
          "xoxo",
          "you"
        ],
        "aliases": [
          "kissing_face"
        ]
      },
      {
        "shortcode": "relaxed",
        "glyph": "☺️",
        "keywords": [
          "face",
          "happy",
          "outlined",
          "relaxed",
          "smile",
          "smiling"
        ],
        "aliases": [
          "smiling_face"
        ]
      },
      {
        "shortcode": "kissing_closed_eyes",
        "glyph": "😚",
        "keywords": [
          "143",
          "bae",
          "blush",
          "closed",
          "date",
          "dating",
          "eye",
          "eyes",
          "face",
          "flirt",
          "ily",
          "kisses",
          "kissing",
          "smooches",
          "xoxo"
        ],
        "aliases": [
          "kissing_face_with_closed_eyes"
        ]
      },
      {
        "shortcode": "kissing_smiling_eyes",
        "glyph": "😙",
        "keywords": [
          "143",
          "closed",
          "date",
          "dating",
          "eye",
          "eyes",
          "face",
          "flirt",
          "ily",
          "kiss",
          "kisses",
          "kissing",
          "love",
          "night",
          "smile",
          "smiling"
        ],
        "aliases": [
          "kissing_face_with_smiling_eyes"
        ]
      },
      {
        "shortcode": "smiling_face_with_tear",
        "glyph": "🥲",
        "keywords": [
          "face",
          "glad",
          "grateful",
          "happy",
          "joy",
          "pain",
          "proud",
          "relieved",
          "smile",
          "smiley",
          "smiling",
          "tear",
          "touched"
        ]
      },
      {
        "shortcode": "yum",
        "glyph": "😋",
        "keywords": [
          "delicious",
          "eat",
          "face",
          "food",
          "full",
          "hungry",
          "savor",
          "smile",
          "smiling",
          "tasty",
          "um",
          "yum",
          "yummy"
        ],
        "aliases": [
          "savoring_food"
        ]
      },
      {
        "shortcode": "stuck_out_tongue",
        "glyph": "😛",
        "keywords": [
          "awesome",
          "cool",
          "face",
          "nice",
          "party",
          "stuck-out",
          "sweet",
          "tongue"
        ],
        "aliases": [
          "face_with_tongue"
        ]
      },
      {
        "shortcode": "stuck_out_tongue_winking_eye",
        "glyph": "😜",
        "keywords": [
          "crazy",
          "epic",
          "eye",
          "face",
          "funny",
          "joke",
          "loopy",
          "nutty",
          "party",
          "stuck-out",
          "tongue",
          "wacky",
          "weirdo",
          "wink",
          "winking",
          "yolo"
        ]
      },
      {
        "shortcode": "zany_face",
        "glyph": "🤪",
        "keywords": [
          "crazy",
          "eye",
          "eyes",
          "face",
          "goofy",
          "large",
          "small",
          "zany"
        ],
        "aliases": [
          "zany"
        ]
      },
      {
        "shortcode": "stuck_out_tongue_closed_eyes",
        "glyph": "😝",
        "keywords": [
          "closed",
          "eye",
          "eyes",
          "face",
          "gross",
          "horrible",
          "omg",
          "squinting",
          "stuck-out",
          "taste",
          "tongue",
          "whatever",
          "yolo"
        ]
      },
      {
        "shortcode": "money_mouth_face",
        "glyph": "🤑",
        "keywords": [
          "face",
          "money",
          "money-mouth",
          "mouth",
          "paid"
        ]
      },
      {
        "shortcode": "hugs",
        "glyph": "🤗",
        "keywords": [
          "face",
          "hands",
          "hug",
          "hugging",
          "open",
          "smiling"
        ],
        "aliases": [
          "hug",
          "hugging",
          "hugging_face"
        ]
      },
      {
        "shortcode": "hand_over_mouth",
        "glyph": "🤭",
        "keywords": [
          "face",
          "giggle",
          "giggling",
          "hand",
          "mouth",
          "oops",
          "realization",
          "secret",
          "shock",
          "sudden",
          "surprise",
          "whoops"
        ],
        "aliases": [
          "face_with_hand_over_mouth"
        ]
      },
      {
        "shortcode": "face_with_open_eyes_and_hand_over_mouth",
        "glyph": "🫢",
        "keywords": [
          "amazement",
          "awe",
          "disbelief",
          "embarrass",
          "eyes",
          "face",
          "gasp",
          "hand",
          "mouth",
          "omg",
          "open",
          "over",
          "quiet",
          "scared",
          "shock",
          "surprise"
        ],
        "aliases": [
          "face_with_open_eyes_hand_over_mouth",
          "gasp"
        ]
      },
      {
        "shortcode": "face_with_peeking_eye",
        "glyph": "🫣",
        "keywords": [
          "captivated",
          "embarrass",
          "eye",
          "face",
          "hide",
          "hiding",
          "peek",
          "peeking",
          "peep",
          "scared",
          "shy",
          "stare"
        ],
        "aliases": [
          "peek"
        ]
      },
      {
        "shortcode": "shushing_face",
        "glyph": "🤫",
        "keywords": [
          "face",
          "quiet",
          "shh",
          "shush",
          "shushing"
        ],
        "aliases": [
          "shush"
        ]
      },
      {
        "shortcode": "thinking",
        "glyph": "🤔",
        "keywords": [
          "chin",
          "consider",
          "face",
          "hmm",
          "ponder",
          "pondering",
          "thinking",
          "wondering"
        ],
        "aliases": [
          "thinking_face",
          "wtf"
        ]
      },
      {
        "shortcode": "saluting_face",
        "glyph": "🫡",
        "keywords": [
          "face",
          "good",
          "luck",
          "ma’am",
          "ok",
          "respect",
          "salute",
          "saluting",
          "sir",
          "troops",
          "yes"
        ],
        "aliases": [
          "salute"
        ]
      },
      {
        "shortcode": "zipper_mouth_face",
        "glyph": "🤐",
        "keywords": [
          "face",
          "keep",
          "mouth",
          "quiet",
          "secret",
          "shut",
          "zip",
          "zipper",
          "zipper-mouth"
        ],
        "aliases": [
          "zipper_mouth"
        ]
      },
      {
        "shortcode": "raised_eyebrow",
        "glyph": "🤨",
        "keywords": [
          "disapproval",
          "disbelief",
          "distrust",
          "emoji",
          "eyebrow",
          "face",
          "hmm",
          "mild",
          "raised",
          "skeptic",
          "skeptical",
          "skepticism",
          "surprise",
          "what"
        ],
        "aliases": [
          "face_with_raised_eyebrow"
        ]
      },
      {
        "shortcode": "neutral_face",
        "glyph": "😐️",
        "keywords": [
          "awkward",
          "blank",
          "deadpan",
          "expressionless",
          "face",
          "fine",
          "jealous",
          "meh",
          "neutral",
          "oh",
          "shade",
          "straight",
          "unamused",
          "unhappy",
          "unimpressed",
          "whatever"
        ],
        "aliases": [
          "neutral"
        ]
      },
      {
        "shortcode": "expressionless",
        "glyph": "😑",
        "keywords": [
          "awkward",
          "dead",
          "expressionless",
          "face",
          "fine",
          "inexpressive",
          "jealous",
          "meh",
          "not",
          "oh",
          "omg",
          "straight",
          "uh",
          "unhappy",
          "unimpressed",
          "whatever"
        ],
        "aliases": [
          "expressionless_face"
        ]
      },
      {
        "shortcode": "no_mouth",
        "glyph": "😶",
        "keywords": [
          "awkward",
          "blank",
          "expressionless",
          "face",
          "mouth",
          "mouthless",
          "mute",
          "quiet",
          "secret",
          "silence",
          "silent",
          "speechless"
        ]
      },
      {
        "shortcode": "dotted_line_face",
        "glyph": "🫥",
        "keywords": [
          "depressed",
          "disappear",
          "dotted",
          "face",
          "hidden",
          "hide",
          "introvert",
          "invisible",
          "line",
          "meh",
          "whatever",
          "wtv"
        ]
      },
      {
        "shortcode": "face_in_clouds",
        "glyph": "😶‍🌫️",
        "keywords": [
          "absentminded",
          "clouds",
          "face",
          "fog",
          "head"
        ],
        "aliases": [
          "in_clouds"
        ]
      },
      {
        "shortcode": "smirk",
        "glyph": "😏",
        "keywords": [
          "boss",
          "dapper",
          "face",
          "flirt",
          "homie",
          "kidding",
          "leer",
          "shade",
          "slick",
          "sly",
          "smirk",
          "smug",
          "snicker",
          "suave",
          "suspicious",
          "swag"
        ],
        "aliases": [
          "smirking",
          "smirking_face"
        ]
      },
      {
        "shortcode": "unamused",
        "glyph": "😒",
        "keywords": [
          "...",
          "bored",
          "face",
          "fine",
          "jealous",
          "jel",
          "jelly",
          "pissed",
          "smh",
          "ugh",
          "uhh",
          "unamused",
          "unhappy",
          "weird",
          "whatever"
        ],
        "aliases": [
          "unamused_face"
        ]
      },
      {
        "shortcode": "roll_eyes",
        "glyph": "🙄",
        "keywords": [
          "eyeroll",
          "eyes",
          "face",
          "rolling",
          "shade",
          "ugh",
          "whatever"
        ],
        "aliases": [
          "rolling_eyes"
        ]
      },
      {
        "shortcode": "grimacing",
        "glyph": "😬",
        "keywords": [
          "awk",
          "awkward",
          "dentist",
          "face",
          "grimace",
          "grimacing",
          "grinning",
          "smile",
          "smiling"
        ],
        "aliases": [
          "grimacing_face"
        ]
      },
      {
        "shortcode": "face_exhaling",
        "glyph": "😮‍💨",
        "keywords": [
          "blow",
          "blowing",
          "exhale",
          "exhaling",
          "exhausted",
          "face",
          "gasp",
          "groan",
          "relief",
          "sigh",
          "smiley",
          "smoke",
          "whisper",
          "whistle"
        ],
        "aliases": [
          "exhale",
          "exhaling"
        ]
      },
      {
        "shortcode": "lying_face",
        "glyph": "🤥",
        "keywords": [
          "face",
          "liar",
          "lie",
          "lying",
          "pinocchio"
        ],
        "aliases": [
          "lying"
        ]
      },
      {
        "shortcode": "shaking_face",
        "glyph": "🫨",
        "keywords": [
          "crazy",
          "daze",
          "earthquake",
          "face",
          "omg",
          "panic",
          "shaking",
          "shock",
          "surprise",
          "vibrate",
          "whoa",
          "wow"
        ],
        "aliases": [
          "shaking"
        ]
      },
      {
        "shortcode": "head_shaking_horizontally",
        "glyph": "🙂‍↔️",
        "keywords": [
          "head",
          "horizontally",
          "no",
          "shake",
          "shaking"
        ]
      },
      {
        "shortcode": "head_shaking_vertically",
        "glyph": "🙂‍↕️",
        "keywords": [
          "head",
          "nod",
          "shaking",
          "vertically",
          "yes"
        ]
      },
      {
        "shortcode": "relieved",
        "glyph": "😌",
        "keywords": [
          "calm",
          "face",
          "peace",
          "relief",
          "relieved",
          "zen"
        ],
        "aliases": [
          "relieved_face"
        ]
      },
      {
        "shortcode": "pensive",
        "glyph": "😔",
        "keywords": [
          "awful",
          "bored",
          "dejected",
          "died",
          "disappointed",
          "face",
          "losing",
          "lost",
          "pensive",
          "sad",
          "sucks"
        ],
        "aliases": [
          "pensive_face"
        ]
      },
      {
        "shortcode": "sleepy",
        "glyph": "😪",
        "keywords": [
          "crying",
          "face",
          "good",
          "night",
          "sad",
          "sleep",
          "sleeping",
          "sleepy",
          "tired"
        ],
        "aliases": [
          "sleepy_face"
        ]
      },
      {
        "shortcode": "drooling_face",
        "glyph": "🤤",
        "keywords": [
          "drooling",
          "face"
        ],
        "aliases": [
          "drooling"
        ]
      },
      {
        "shortcode": "sleeping",
        "glyph": "😴",
        "keywords": [
          "bed",
          "bedtime",
          "face",
          "good",
          "goodnight",
          "nap",
          "night",
          "sleep",
          "sleeping",
          "tired",
          "whatever",
          "yawn",
          "zzz"
        ],
        "aliases": [
          "sleeping_face"
        ]
      },
      {
        "shortcode": "face_with_eye_bags",
        "glyph": "🫩",
        "keywords": [
          "bags",
          "bored",
          "exhausted",
          "eyes",
          "face",
          "fatigued",
          "late",
          "sleepy",
          "tired",
          "weary"
        ]
      },
      {
        "shortcode": "mask",
        "glyph": "😷",
        "keywords": [
          "cold",
          "dentist",
          "dermatologist",
          "doctor",
          "dr",
          "face",
          "germs",
          "mask",
          "medical",
          "medicine",
          "sick"
        ],
        "aliases": [
          "medical_mask"
        ]
      },
      {
        "shortcode": "face_with_thermometer",
        "glyph": "🤒",
        "keywords": [
          "face",
          "ill",
          "sick",
          "thermometer"
        ]
      },
      {
        "shortcode": "face_with_head_bandage",
        "glyph": "🤕",
        "keywords": [
          "bandage",
          "face",
          "head-bandage",
          "hurt",
          "injury",
          "ouch"
        ]
      },
      {
        "shortcode": "nauseated_face",
        "glyph": "🤢",
        "keywords": [
          "face",
          "gross",
          "nasty",
          "nauseated",
          "sick",
          "vomit"
        ],
        "aliases": [
          "nauseated"
        ]
      },
      {
        "shortcode": "vomiting_face",
        "glyph": "🤮",
        "keywords": [
          "barf",
          "ew",
          "face",
          "gross",
          "puke",
          "sick",
          "spew",
          "throw",
          "up",
          "vomit",
          "vomiting"
        ],
        "aliases": [
          "face_vomiting",
          "vomiting"
        ]
      },
      {
        "shortcode": "sneezing_face",
        "glyph": "🤧",
        "keywords": [
          "face",
          "fever",
          "flu",
          "gesundheit",
          "sick",
          "sneeze",
          "sneezing"
        ],
        "aliases": [
          "sneezing"
        ]
      },
      {
        "shortcode": "hot_face",
        "glyph": "🥵",
        "keywords": [
          "dying",
          "face",
          "feverish",
          "heat",
          "hot",
          "panting",
          "red-faced",
          "stroke",
          "sweating",
          "tongue"
        ],
        "aliases": [
          "hot"
        ]
      },
      {
        "shortcode": "cold_face",
        "glyph": "🥶",
        "keywords": [
          "blue",
          "blue-faced",
          "cold",
          "face",
          "freezing",
          "frostbite",
          "icicles",
          "subzero",
          "teeth"
        ],
        "aliases": [
          "cold"
        ]
      },
      {
        "shortcode": "woozy_face",
        "glyph": "🥴",
        "keywords": [
          "dizzy",
          "drunk",
          "eyes",
          "face",
          "intoxicated",
          "mouth",
          "tipsy",
          "uneven",
          "wavy",
          "woozy"
        ],
        "aliases": [
          "woozy"
        ]
      },
      {
        "shortcode": "dizzy_face",
        "glyph": "😵",
        "keywords": [
          "crossed-out",
          "dead",
          "dizzy",
          "eyes",
          "face",
          "feels",
          "knocked",
          "out",
          "sick",
          "tired"
        ],
        "aliases": [
          "knocked_out"
        ]
      },
      {
        "shortcode": "face_with_spiral_eyes",
        "glyph": "😵‍💫",
        "keywords": [
          "confused",
          "dizzy",
          "eyes",
          "face",
          "hypnotized",
          "omg",
          "smiley",
          "spiral",
          "trouble",
          "whoa",
          "woah",
          "woozy"
        ],
        "aliases": [
          "dizzy_eyes"
        ]
      },
      {
        "shortcode": "exploding_head",
        "glyph": "🤯",
        "keywords": [
          "blown",
          "explode",
          "exploding",
          "head",
          "mind",
          "mindblown",
          "no",
          "shocked",
          "way"
        ]
      },
      {
        "shortcode": "cowboy_hat_face",
        "glyph": "🤠",
        "keywords": [
          "cowboy",
          "cowgirl",
          "face",
          "hat"
        ],
        "aliases": [
          "cowboy",
          "cowboy_face"
        ]
      },
      {
        "shortcode": "partying_face",
        "glyph": "🥳",
        "keywords": [
          "bday",
          "birthday",
          "celebrate",
          "celebration",
          "excited",
          "face",
          "happy",
          "hat",
          "hooray",
          "horn",
          "party",
          "partying"
        ],
        "aliases": [
          "hooray",
          "partying"
        ]
      },
      {
        "shortcode": "disguised_face",
        "glyph": "🥸",
        "keywords": [
          "disguise",
          "eyebrow",
          "face",
          "glasses",
          "incognito",
          "moustache",
          "mustache",
          "nose",
          "person",
          "spy",
          "tache",
          "tash"
        ],
        "aliases": [
          "disguised"
        ]
      },
      {
        "shortcode": "sunglasses",
        "glyph": "😎",
        "keywords": [
          "awesome",
          "beach",
          "bright",
          "bro",
          "chilling",
          "cool",
          "face",
          "rad",
          "relaxed",
          "shades",
          "slay",
          "smile",
          "style",
          "sunglasses",
          "swag",
          "win"
        ],
        "aliases": [
          "smiling_face_with_sunglasses",
          "sunglasses_cool",
          "too_cool"
        ]
      },
      {
        "shortcode": "nerd_face",
        "glyph": "🤓",
        "keywords": [
          "brainy",
          "clever",
          "expert",
          "face",
          "geek",
          "gifted",
          "glasses",
          "intelligent",
          "nerd",
          "smart"
        ],
        "aliases": [
          "nerd"
        ]
      },
      {
        "shortcode": "monocle_face",
        "glyph": "🧐",
        "keywords": [
          "classy",
          "face",
          "fancy",
          "monocle",
          "rich",
          "stuffy",
          "wealthy"
        ],
        "aliases": [
          "face_with_monocle"
        ]
      },
      {
        "shortcode": "confused",
        "glyph": "😕",
        "keywords": [
          "befuddled",
          "confused",
          "confusing",
          "dunno",
          "face",
          "frown",
          "hm",
          "meh",
          "not",
          "sad",
          "sorry",
          "sure"
        ],
        "aliases": [
          "confused_face"
        ]
      },
      {
        "shortcode": "face_with_diagonal_mouth",
        "glyph": "🫤",
        "keywords": [
          "confused",
          "confusion",
          "diagonal",
          "disappointed",
          "doubt",
          "doubtful",
          "face",
          "frustrated",
          "frustration",
          "meh",
          "mouth",
          "skeptical",
          "unsure",
          "whatever",
          "wtv"
        ]
      },
      {
        "shortcode": "worried",
        "glyph": "😟",
        "keywords": [
          "anxious",
          "butterflies",
          "face",
          "nerves",
          "nervous",
          "sad",
          "stress",
          "stressed",
          "surprised",
          "worried",
          "worry"
        ],
        "aliases": [
          "worried_face"
        ]
      },
      {
        "shortcode": "slightly_frowning_face",
        "glyph": "🙁",
        "keywords": [
          "face",
          "frown",
          "frowning",
          "sad",
          "slightly"
        ]
      },
      {
        "shortcode": "frowning_face",
        "glyph": "☹️",
        "keywords": [
          "face",
          "frown",
          "frowning",
          "sad"
        ],
        "aliases": [
          "white_frowning_face"
        ]
      },
      {
        "shortcode": "open_mouth",
        "glyph": "😮",
        "keywords": [
          "believe",
          "face",
          "forgot",
          "mouth",
          "omg",
          "open",
          "shocked",
          "surprised",
          "sympathy",
          "unbelievable",
          "unreal",
          "whoa",
          "wow",
          "you"
        ],
        "aliases": [
          "face_with_open_mouth"
        ]
      },
      {
        "shortcode": "hushed",
        "glyph": "😯",
        "keywords": [
          "epic",
          "face",
          "hushed",
          "omg",
          "stunned",
          "surprised",
          "whoa",
          "woah"
        ],
        "aliases": [
          "hushed_face"
        ]
      },
      {
        "shortcode": "astonished",
        "glyph": "😲",
        "keywords": [
          "astonished",
          "cost",
          "face",
          "no",
          "omg",
          "shocked",
          "totally",
          "way"
        ],
        "aliases": [
          "astonished_face"
        ]
      },
      {
        "shortcode": "flushed",
        "glyph": "😳",
        "keywords": [
          "amazed",
          "awkward",
          "crazy",
          "dazed",
          "dead",
          "disbelief",
          "embarrassed",
          "face",
          "flushed",
          "geez",
          "heat",
          "hot",
          "impressed",
          "jeez",
          "what",
          "wow"
        ],
        "aliases": [
          "flushed_face"
        ]
      },
      {
        "shortcode": "distorted_face",
        "glyph": "🫪",
        "keywords": [
          "anxiety",
          "bloated",
          "panic",
          "shocked",
          "surprised",
          "vulnerable"
        ]
      },
      {
        "shortcode": "pleading_face",
        "glyph": "🥺",
        "keywords": [
          "begging",
          "big",
          "eyes",
          "face",
          "mercy",
          "not",
          "pleading",
          "please",
          "pretty",
          "puppy",
          "sad",
          "why"
        ],
        "aliases": [
          "pleading"
        ]
      },
      {
        "shortcode": "face_holding_back_tears",
        "glyph": "🥹",
        "keywords": [
          "admiration",
          "aww",
          "back",
          "cry",
          "embarrassed",
          "face",
          "feelings",
          "grateful",
          "gratitude",
          "holding",
          "joy",
          "please",
          "proud",
          "resist",
          "sad",
          "tears"
        ],
        "aliases": [
          "watery_eyes"
        ]
      },
      {
        "shortcode": "frowning",
        "glyph": "😦",
        "keywords": [
          "caught",
          "face",
          "frown",
          "frowning",
          "guard",
          "mouth",
          "open",
          "scared",
          "scary",
          "surprise",
          "what",
          "wow"
        ],
        "aliases": [
          "frowning_face"
        ]
      },
      {
        "shortcode": "anguished",
        "glyph": "😧",
        "keywords": [
          "anguished",
          "face",
          "forgot",
          "scared",
          "scary",
          "stressed",
          "surprise",
          "unhappy",
          "what",
          "wow"
        ],
        "aliases": [
          "anguished_face"
        ]
      },
      {
        "shortcode": "fearful",
        "glyph": "😨",
        "keywords": [
          "afraid",
          "anxious",
          "blame",
          "face",
          "fear",
          "fearful",
          "scared",
          "worried"
        ],
        "aliases": [
          "fearful_face"
        ]
      },
      {
        "shortcode": "cold_sweat",
        "glyph": "😰",
        "keywords": [
          "anxious",
          "blue",
          "cold",
          "eek",
          "face",
          "mouth",
          "nervous",
          "open",
          "rushed",
          "scared",
          "sweat",
          "yikes"
        ],
        "aliases": [
          "anxious",
          "anxious_face"
        ]
      },
      {
        "shortcode": "disappointed_relieved",
        "glyph": "😥",
        "keywords": [
          "anxious",
          "call",
          "close",
          "complicated",
          "disappointed",
          "face",
          "not",
          "relieved",
          "sad",
          "sweat",
          "time",
          "whew"
        ],
        "aliases": [
          "sad_relieved_face"
        ]
      },
      {
        "shortcode": "cry",
        "glyph": "😢",
        "keywords": [
          "awful",
          "cry",
          "crying",
          "face",
          "feels",
          "miss",
          "sad",
          "tear",
          "triste",
          "unhappy"
        ],
        "aliases": [
          "crying_face"
        ]
      },
      {
        "shortcode": "sob",
        "glyph": "😭",
        "keywords": [
          "bawling",
          "cry",
          "crying",
          "face",
          "loudly",
          "sad",
          "sob",
          "tear",
          "tears",
          "unhappy"
        ],
        "aliases": [
          "loudly_crying_face"
        ]
      },
      {
        "shortcode": "scream",
        "glyph": "😱",
        "keywords": [
          "epic",
          "face",
          "fear",
          "fearful",
          "munch",
          "scared",
          "scream",
          "screamer",
          "screaming",
          "shocked",
          "surprised",
          "woah"
        ],
        "aliases": [
          "screaming_in_fear"
        ]
      },
      {
        "shortcode": "confounded",
        "glyph": "😖",
        "keywords": [
          "annoyed",
          "confounded",
          "confused",
          "cringe",
          "distraught",
          "face",
          "feels",
          "frustrated",
          "mad",
          "sad"
        ],
        "aliases": [
          "confounded_face"
        ]
      },
      {
        "shortcode": "persevere",
        "glyph": "😣",
        "keywords": [
          "concentrate",
          "concentration",
          "face",
          "focus",
          "headache",
          "persevere",
          "persevering"
        ],
        "aliases": [
          "persevering_face"
        ]
      },
      {
        "shortcode": "disappointed",
        "glyph": "😞",
        "keywords": [
          "awful",
          "blame",
          "dejected",
          "disappointed",
          "face",
          "fail",
          "losing",
          "sad",
          "unhappy"
        ],
        "aliases": [
          "disappointed_face"
        ]
      },
      {
        "shortcode": "sweat",
        "glyph": "😓",
        "keywords": [
          "close",
          "cold",
          "downcast",
          "face",
          "feels",
          "headache",
          "nervous",
          "sad",
          "scared",
          "sweat",
          "yikes"
        ],
        "aliases": [
          "downcast_face"
        ]
      },
      {
        "shortcode": "weary",
        "glyph": "😩",
        "keywords": [
          "crying",
          "face",
          "fail",
          "feels",
          "hungry",
          "mad",
          "nooo",
          "sad",
          "sleepy",
          "tired",
          "unhappy",
          "weary"
        ],
        "aliases": [
          "weary_face"
        ]
      },
      {
        "shortcode": "tired_face",
        "glyph": "😫",
        "keywords": [
          "cost",
          "face",
          "feels",
          "nap",
          "sad",
          "sneeze",
          "tired"
        ],
        "aliases": [
          "tired"
        ]
      },
      {
        "shortcode": "yawning_face",
        "glyph": "🥱",
        "keywords": [
          "bedtime",
          "bored",
          "face",
          "goodnight",
          "nap",
          "night",
          "sleep",
          "sleepy",
          "tired",
          "whatever",
          "yawn",
          "yawning",
          "zzz"
        ],
        "aliases": [
          "yawn",
          "yawning"
        ]
      },
      {
        "shortcode": "triumph",
        "glyph": "😤",
        "keywords": [
          "anger",
          "angry",
          "face",
          "feels",
          "fume",
          "fuming",
          "furious",
          "fury",
          "mad",
          "nose",
          "steam",
          "triumph",
          "unhappy",
          "won"
        ],
        "aliases": [
          "nose_steam"
        ]
      },
      {
        "shortcode": "pout",
        "glyph": "😡",
        "keywords": [
          "anger",
          "angry",
          "enraged",
          "face",
          "feels",
          "mad",
          "maddening",
          "pouting",
          "rage",
          "red",
          "shade",
          "unhappy",
          "upset"
        ],
        "aliases": [
          "rage",
          "pouting_face"
        ]
      },
      {
        "shortcode": "angry",
        "glyph": "😠",
        "keywords": [
          "anger",
          "angry",
          "blame",
          "face",
          "feels",
          "frustrated",
          "mad",
          "maddening",
          "rage",
          "shade",
          "unhappy",
          "upset"
        ],
        "aliases": [
          "angry_face"
        ]
      },
      {
        "shortcode": "cursing_face",
        "glyph": "🤬",
        "keywords": [
          "censor",
          "cursing",
          "cussing",
          "face",
          "mad",
          "mouth",
          "pissed",
          "swearing",
          "symbols"
        ],
        "aliases": [
          "censored",
          "face_with_symbols_on_mouth"
        ]
      },
      {
        "shortcode": "smiling_imp",
        "glyph": "😈",
        "keywords": [
          "demon",
          "devil",
          "evil",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "horns",
          "purple",
          "shade",
          "smile",
          "smiling",
          "tale"
        ]
      },
      {
        "shortcode": "imp",
        "glyph": "👿",
        "keywords": [
          "angry",
          "demon",
          "devil",
          "evil",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "horns",
          "imp",
          "mischievous",
          "purple",
          "shade",
          "tale"
        ],
        "aliases": [
          "angry_imp"
        ]
      },
      {
        "shortcode": "skull",
        "glyph": "💀",
        "keywords": [
          "body",
          "dead",
          "death",
          "face",
          "fairy",
          "fairytale",
          "i’m",
          "lmao",
          "monster",
          "tale",
          "yolo"
        ]
      },
      {
        "shortcode": "skull_and_crossbones",
        "glyph": "☠️",
        "keywords": [
          "bone",
          "crossbones",
          "dead",
          "death",
          "face",
          "monster",
          "skull"
        ]
      },
      {
        "shortcode": "hankey",
        "glyph": "💩",
        "keywords": [
          "bs",
          "comic",
          "doo",
          "dung",
          "face",
          "fml",
          "monster",
          "pile",
          "poo",
          "poop",
          "smelly",
          "smh",
          "stink",
          "stinks",
          "stinky",
          "turd"
        ],
        "aliases": [
          "poop",
          "shit"
        ]
      },
      {
        "shortcode": "clown_face",
        "glyph": "🤡",
        "keywords": [
          "clown",
          "face"
        ],
        "aliases": [
          "clown"
        ]
      },
      {
        "shortcode": "japanese_ogre",
        "glyph": "👹",
        "keywords": [
          "creature",
          "devil",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "mask",
          "monster",
          "scary",
          "tale"
        ],
        "aliases": [
          "ogre"
        ]
      },
      {
        "shortcode": "japanese_goblin",
        "glyph": "👺",
        "keywords": [
          "angry",
          "creature",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "mask",
          "mean",
          "monster",
          "tale"
        ],
        "aliases": [
          "goblin"
        ]
      },
      {
        "shortcode": "ghost",
        "glyph": "👻",
        "keywords": [
          "boo",
          "creature",
          "excited",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "halloween",
          "haunting",
          "monster",
          "scary",
          "silly",
          "tale"
        ]
      },
      {
        "shortcode": "alien",
        "glyph": "👽️",
        "keywords": [
          "creature",
          "extraterrestrial",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "monster",
          "space",
          "tale",
          "ufo"
        ]
      },
      {
        "shortcode": "space_invader",
        "glyph": "👾",
        "keywords": [
          "alien",
          "creature",
          "extraterrestrial",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "game",
          "gamer",
          "games",
          "monster",
          "pixelated",
          "space",
          "tale",
          "ufo"
        ],
        "aliases": [
          "alien_monster"
        ]
      },
      {
        "shortcode": "robot",
        "glyph": "🤖",
        "keywords": [
          "face",
          "monster"
        ],
        "aliases": [
          "robot_face"
        ]
      },
      {
        "shortcode": "smiley_cat",
        "glyph": "😺",
        "keywords": [
          "animal",
          "cat",
          "face",
          "grinning",
          "mouth",
          "open",
          "smile",
          "smiling"
        ],
        "aliases": [
          "grinning_cat"
        ]
      },
      {
        "shortcode": "smile_cat",
        "glyph": "😸",
        "keywords": [
          "animal",
          "cat",
          "eye",
          "eyes",
          "face",
          "grin",
          "grinning",
          "smile",
          "smiling"
        ],
        "aliases": [
          "grinning_cat_with_closed_eyes"
        ]
      },
      {
        "shortcode": "joy_cat",
        "glyph": "😹",
        "keywords": [
          "animal",
          "cat",
          "face",
          "joy",
          "laugh",
          "laughing",
          "lol",
          "tear",
          "tears"
        ],
        "aliases": [
          "tears_of_joy_cat"
        ]
      },
      {
        "shortcode": "heart_eyes_cat",
        "glyph": "😻",
        "keywords": [
          "animal",
          "cat",
          "eye",
          "face",
          "heart",
          "heart-eyes",
          "love",
          "smile",
          "smiling"
        ],
        "aliases": [
          "smiling_cat_with_heart_eyes"
        ]
      },
      {
        "shortcode": "smirk_cat",
        "glyph": "😼",
        "keywords": [
          "animal",
          "cat",
          "face",
          "ironic",
          "smile",
          "wry"
        ],
        "aliases": [
          "wry_smile_cat"
        ]
      },
      {
        "shortcode": "kissing_cat",
        "glyph": "😽",
        "keywords": [
          "animal",
          "cat",
          "closed",
          "eye",
          "eyes",
          "face",
          "kiss",
          "kissing"
        ]
      },
      {
        "shortcode": "scream_cat",
        "glyph": "🙀",
        "keywords": [
          "animal",
          "cat",
          "face",
          "oh",
          "surprised",
          "weary"
        ],
        "aliases": [
          "weary_cat"
        ]
      },
      {
        "shortcode": "crying_cat_face",
        "glyph": "😿",
        "keywords": [
          "animal",
          "cat",
          "cry",
          "crying",
          "face",
          "sad",
          "tear"
        ],
        "aliases": [
          "crying_cat"
        ]
      },
      {
        "shortcode": "pouting_cat",
        "glyph": "😾",
        "keywords": [
          "animal",
          "cat",
          "face",
          "pouting"
        ]
      },
      {
        "shortcode": "see_no_evil",
        "glyph": "🙈",
        "keywords": [
          "embarrassed",
          "evil",
          "face",
          "forbidden",
          "forgot",
          "gesture",
          "hide",
          "monkey",
          "no",
          "omg",
          "prohibited",
          "scared",
          "secret",
          "smh",
          "watch"
        ]
      },
      {
        "shortcode": "hear_no_evil",
        "glyph": "🙉",
        "keywords": [
          "animal",
          "ears",
          "evil",
          "face",
          "forbidden",
          "gesture",
          "hear",
          "listen",
          "monkey",
          "no",
          "not",
          "prohibited",
          "secret",
          "shh",
          "tmi"
        ]
      },
      {
        "shortcode": "speak_no_evil",
        "glyph": "🙊",
        "keywords": [
          "animal",
          "evil",
          "face",
          "forbidden",
          "gesture",
          "monkey",
          "no",
          "not",
          "oops",
          "prohibited",
          "quiet",
          "secret",
          "speak",
          "stealth"
        ]
      },
      {
        "shortcode": "love_letter",
        "glyph": "💌",
        "keywords": [
          "heart",
          "letter",
          "love",
          "mail",
          "romance",
          "valentine"
        ]
      },
      {
        "shortcode": "cupid",
        "glyph": "💘",
        "keywords": [
          "143",
          "adorbs",
          "arrow",
          "cupid",
          "date",
          "emotion",
          "heart",
          "ily",
          "love",
          "romance",
          "valentine"
        ],
        "aliases": [
          "heart_with_arrow"
        ]
      },
      {
        "shortcode": "gift_heart",
        "glyph": "💝",
        "keywords": [
          "143",
          "anniversary",
          "emotion",
          "heart",
          "ily",
          "kisses",
          "ribbon",
          "valentine",
          "xoxo"
        ],
        "aliases": [
          "heart_with_ribbon"
        ]
      },
      {
        "shortcode": "sparkling_heart",
        "glyph": "💖",
        "keywords": [
          "143",
          "emotion",
          "excited",
          "good",
          "heart",
          "ily",
          "kisses",
          "morning",
          "night",
          "sparkle",
          "sparkling",
          "xoxo"
        ]
      },
      {
        "shortcode": "heartpulse",
        "glyph": "💗",
        "keywords": [
          "143",
          "emotion",
          "excited",
          "growing",
          "heart",
          "heartpulse",
          "ily",
          "kisses",
          "muah",
          "nervous",
          "pulse",
          "xoxo"
        ],
        "aliases": [
          "growing_heart"
        ]
      },
      {
        "shortcode": "heartbeat",
        "glyph": "💓",
        "keywords": [
          "143",
          "beating",
          "cardio",
          "emotion",
          "heart",
          "heartbeat",
          "ily",
          "love",
          "pulsating",
          "pulse"
        ],
        "aliases": [
          "beating_heart"
        ]
      },
      {
        "shortcode": "revolving_hearts",
        "glyph": "💞",
        "keywords": [
          "143",
          "adorbs",
          "anniversary",
          "emotion",
          "heart",
          "hearts",
          "revolving"
        ]
      },
      {
        "shortcode": "two_hearts",
        "glyph": "💕",
        "keywords": [
          "143",
          "anniversary",
          "date",
          "dating",
          "emotion",
          "heart",
          "hearts",
          "ily",
          "kisses",
          "love",
          "loving",
          "two",
          "xoxo"
        ]
      },
      {
        "shortcode": "heart_decoration",
        "glyph": "💟",
        "keywords": [
          "143",
          "decoration",
          "emotion",
          "heart",
          "hearth",
          "purple",
          "white"
        ]
      },
      {
        "shortcode": "heavy_heart_exclamation",
        "glyph": "❣️",
        "keywords": [
          "exclamation",
          "heart",
          "heavy",
          "mark",
          "punctuation"
        ],
        "aliases": [
          "heart_exclamation"
        ]
      },
      {
        "shortcode": "broken_heart",
        "glyph": "💔",
        "keywords": [
          "break",
          "broken",
          "crushed",
          "emotion",
          "heart",
          "heartbroken",
          "lonely",
          "sad"
        ]
      },
      {
        "shortcode": "heart_on_fire",
        "glyph": "❤️‍🔥",
        "keywords": [
          "burn",
          "fire",
          "heart",
          "love",
          "lust",
          "sacred"
        ]
      },
      {
        "shortcode": "mending_heart",
        "glyph": "❤️‍🩹",
        "keywords": [
          "healthier",
          "heart",
          "improving",
          "mending",
          "recovering",
          "recuperating",
          "well"
        ]
      },
      {
        "shortcode": "heart",
        "glyph": "❤️",
        "keywords": [
          "emotion",
          "heart",
          "love",
          "red"
        ],
        "aliases": [
          "red_heart"
        ]
      },
      {
        "shortcode": "pink_heart",
        "glyph": "🩷",
        "keywords": [
          "143",
          "adorable",
          "cute",
          "emotion",
          "heart",
          "ily",
          "like",
          "love",
          "pink",
          "special",
          "sweet"
        ]
      },
      {
        "shortcode": "orange_heart",
        "glyph": "🧡",
        "keywords": [
          "143",
          "heart",
          "orange"
        ]
      },
      {
        "shortcode": "yellow_heart",
        "glyph": "💛",
        "keywords": [
          "143",
          "cardiac",
          "emotion",
          "heart",
          "ily",
          "love",
          "yellow"
        ]
      },
      {
        "shortcode": "green_heart",
        "glyph": "💚",
        "keywords": [
          "143",
          "emotion",
          "green",
          "heart",
          "ily",
          "love",
          "romantic"
        ]
      },
      {
        "shortcode": "blue_heart",
        "glyph": "💙",
        "keywords": [
          "143",
          "blue",
          "emotion",
          "heart",
          "ily",
          "love",
          "romance"
        ]
      },
      {
        "shortcode": "light_blue_heart",
        "glyph": "🩵",
        "keywords": [
          "143",
          "blue",
          "cute",
          "cyan",
          "emotion",
          "heart",
          "ily",
          "light",
          "like",
          "love",
          "sky",
          "special",
          "teal"
        ]
      },
      {
        "shortcode": "purple_heart",
        "glyph": "💜",
        "keywords": [
          "143",
          "bestest",
          "emotion",
          "heart",
          "ily",
          "love",
          "purple"
        ]
      },
      {
        "shortcode": "brown_heart",
        "glyph": "🤎",
        "keywords": [
          "143",
          "brown",
          "heart"
        ]
      },
      {
        "shortcode": "black_heart",
        "glyph": "🖤",
        "keywords": [
          "black",
          "evil",
          "heart",
          "wicked"
        ]
      },
      {
        "shortcode": "grey_heart",
        "glyph": "🩶",
        "keywords": [
          "143",
          "emotion",
          "gray",
          "grey",
          "heart",
          "ily",
          "love",
          "silver",
          "slate",
          "special"
        ],
        "aliases": [
          "gray_heart"
        ]
      },
      {
        "shortcode": "white_heart",
        "glyph": "🤍",
        "keywords": [
          "143",
          "heart",
          "white"
        ]
      },
      {
        "shortcode": "kiss",
        "glyph": "💋",
        "keywords": [
          "dating",
          "emotion",
          "heart",
          "kiss",
          "kissing",
          "lips",
          "mark",
          "romance",
          "sexy"
        ]
      },
      {
        "shortcode": "100",
        "glyph": "💯",
        "keywords": [
          "100",
          "a+",
          "agree",
          "clearly",
          "definitely",
          "faithful",
          "fleek",
          "full",
          "hundred",
          "keep",
          "perfect",
          "point",
          "score",
          "true",
          "truth",
          "yup"
        ]
      },
      {
        "shortcode": "anger",
        "glyph": "💢",
        "keywords": [
          "anger",
          "angry",
          "comic",
          "mad",
          "symbol",
          "upset"
        ]
      },
      {
        "shortcode": "fight_cloud",
        "glyph": "🫯",
        "keywords": [
          "argument",
          "brawl",
          "debate",
          "disagreement",
          "fight",
          "ruckus",
          "wrestle"
        ]
      },
      {
        "shortcode": "boom",
        "glyph": "💥",
        "keywords": [
          "bomb",
          "boom",
          "collide",
          "comic",
          "explode"
        ],
        "aliases": [
          "collision"
        ]
      },
      {
        "shortcode": "dizzy",
        "glyph": "💫",
        "keywords": [
          "comic",
          "shining",
          "shooting",
          "star",
          "stars"
        ]
      },
      {
        "shortcode": "sweat_drops",
        "glyph": "💦",
        "keywords": [
          "comic",
          "drip",
          "droplet",
          "droplets",
          "drops",
          "splashing",
          "squirt",
          "sweat",
          "water",
          "wet",
          "work",
          "workout"
        ]
      },
      {
        "shortcode": "dash",
        "glyph": "💨",
        "keywords": [
          "away",
          "cloud",
          "comic",
          "dash",
          "dashing",
          "fart",
          "fast",
          "go",
          "gone",
          "gotta",
          "running",
          "smoke"
        ],
        "aliases": [
          "dashing_away"
        ]
      },
      {
        "shortcode": "hole",
        "glyph": "🕳️",
        "keywords": [
          "hole"
        ]
      },
      {
        "shortcode": "speech_balloon",
        "glyph": "💬",
        "keywords": [
          "balloon",
          "bubble",
          "comic",
          "dialog",
          "message",
          "sms",
          "speech",
          "talk",
          "text",
          "typing"
        ]
      },
      {
        "shortcode": "eye_speech_bubble",
        "glyph": "👁️‍🗨️",
        "keywords": [
          "balloon",
          "bubble",
          "eye",
          "speech",
          "witness"
        ],
        "aliases": [
          "eye_in_speech_bubble"
        ]
      },
      {
        "shortcode": "left_speech_bubble",
        "glyph": "🗨️",
        "keywords": [
          "balloon",
          "bubble",
          "dialog",
          "left",
          "speech"
        ]
      },
      {
        "shortcode": "right_anger_bubble",
        "glyph": "🗯️",
        "keywords": [
          "anger",
          "angry",
          "balloon",
          "bubble",
          "mad",
          "right"
        ]
      },
      {
        "shortcode": "thought_balloon",
        "glyph": "💭",
        "keywords": [
          "balloon",
          "bubble",
          "cartoon",
          "cloud",
          "comic",
          "daydream",
          "decisions",
          "dream",
          "idea",
          "invent",
          "invention",
          "realize",
          "think",
          "thoughts",
          "wonder"
        ]
      },
      {
        "shortcode": "zzz",
        "glyph": "💤",
        "keywords": [
          "comic",
          "good",
          "goodnight",
          "night",
          "sleep",
          "sleeping",
          "sleepy",
          "tired",
          "zzz"
        ]
      }
    ]
  },
  {
    "id": "people",
    "icon": "👋",
    "name": "People & Body",
    "entries": [
      {
        "shortcode": "wave",
        "glyph": "👋",
        "keywords": [
          "bye",
          "cya",
          "g2g",
          "greetings",
          "gtg",
          "hand",
          "hello",
          "hey",
          "hi",
          "later",
          "outtie",
          "ttfn",
          "ttyl",
          "wave",
          "yo",
          "you"
        ],
        "aliases": [
          "waving_hand"
        ]
      },
      {
        "shortcode": "raised_back_of_hand",
        "glyph": "🤚",
        "keywords": [
          "back",
          "backhand",
          "hand",
          "raised"
        ]
      },
      {
        "shortcode": "raised_hand_with_fingers_splayed",
        "glyph": "🖐️",
        "keywords": [
          "finger",
          "fingers",
          "hand",
          "raised",
          "splayed",
          "stop"
        ]
      },
      {
        "shortcode": "hand",
        "glyph": "✋️",
        "keywords": [
          "5",
          "five",
          "hand",
          "high",
          "raised",
          "stop"
        ],
        "aliases": [
          "raised_hand",
          "high_five"
        ]
      },
      {
        "shortcode": "vulcan_salute",
        "glyph": "🖖",
        "keywords": [
          "finger",
          "hand",
          "hands",
          "salute",
          "vulcan"
        ],
        "aliases": [
          "vulcan"
        ]
      },
      {
        "shortcode": "rightwards_hand",
        "glyph": "🫱",
        "keywords": [
          "hand",
          "handshake",
          "hold",
          "reach",
          "right",
          "rightward",
          "rightwards",
          "shake"
        ]
      },
      {
        "shortcode": "leftwards_hand",
        "glyph": "🫲",
        "keywords": [
          "hand",
          "handshake",
          "hold",
          "left",
          "leftward",
          "leftwards",
          "reach",
          "shake"
        ]
      },
      {
        "shortcode": "palm_down_hand",
        "glyph": "🫳",
        "keywords": [
          "dismiss",
          "down",
          "drop",
          "dropped",
          "hand",
          "palm",
          "pick",
          "shoo",
          "up"
        ],
        "aliases": [
          "palm_down"
        ]
      },
      {
        "shortcode": "palm_up_hand",
        "glyph": "🫴",
        "keywords": [
          "beckon",
          "catch",
          "come",
          "hand",
          "hold",
          "know",
          "lift",
          "me",
          "offer",
          "palm",
          "tell"
        ],
        "aliases": [
          "palm_up"
        ]
      },
      {
        "shortcode": "leftwards_pushing_hand",
        "glyph": "🫷",
        "keywords": [
          "block",
          "five",
          "halt",
          "hand",
          "high",
          "hold",
          "leftward",
          "leftwards",
          "pause",
          "push",
          "pushing",
          "refuse",
          "slap",
          "stop",
          "wait"
        ]
      },
      {
        "shortcode": "rightwards_pushing_hand",
        "glyph": "🫸",
        "keywords": [
          "block",
          "five",
          "halt",
          "hand",
          "high",
          "hold",
          "pause",
          "push",
          "pushing",
          "refuse",
          "rightward",
          "rightwards",
          "slap",
          "stop",
          "wait"
        ]
      },
      {
        "shortcode": "ok_hand",
        "glyph": "👌",
        "keywords": [
          "awesome",
          "bet",
          "dope",
          "fleek",
          "fosho",
          "got",
          "gotcha",
          "hand",
          "legit",
          "ok",
          "okay",
          "pinch",
          "rad",
          "sure",
          "sweet",
          "three"
        ]
      },
      {
        "shortcode": "pinched_fingers",
        "glyph": "🤌",
        "keywords": [
          "fingers",
          "gesture",
          "hand",
          "hold",
          "huh",
          "interrogation",
          "patience",
          "pinched",
          "relax",
          "sarcastic",
          "ugh",
          "what",
          "zip"
        ],
        "aliases": [
          "pinch"
        ]
      },
      {
        "shortcode": "pinching_hand",
        "glyph": "🤏",
        "keywords": [
          "amount",
          "bit",
          "fingers",
          "hand",
          "little",
          "pinching",
          "small",
          "sort"
        ]
      },
      {
        "shortcode": "v",
        "glyph": "✌️",
        "keywords": [
          "hand",
          "peace",
          "v",
          "victory"
        ],
        "aliases": [
          "victory"
        ]
      },
      {
        "shortcode": "crossed_fingers",
        "glyph": "🤞",
        "keywords": [
          "cross",
          "crossed",
          "finger",
          "fingers",
          "hand",
          "luck"
        ],
        "aliases": [
          "fingers_crossed"
        ]
      },
      {
        "shortcode": "hand_with_index_finger_and_thumb_crossed",
        "glyph": "🫰",
        "keywords": [
          "<3",
          "crossed",
          "expensive",
          "finger",
          "hand",
          "heart",
          "index",
          "love",
          "money",
          "snap",
          "thumb"
        ]
      },
      {
        "shortcode": "love_you_gesture",
        "glyph": "🤟",
        "keywords": [
          "fingers",
          "gesture",
          "hand",
          "ily",
          "love",
          "love-you",
          "three",
          "you"
        ]
      },
      {
        "shortcode": "metal",
        "glyph": "🤘",
        "keywords": [
          "finger",
          "hand",
          "horns",
          "rock-on",
          "sign"
        ],
        "aliases": [
          "sign_of_the_horns"
        ]
      },
      {
        "shortcode": "call_me_hand",
        "glyph": "🤙",
        "keywords": [
          "call",
          "hand",
          "hang",
          "loose",
          "me",
          "shaka"
        ]
      },
      {
        "shortcode": "point_left",
        "glyph": "👈️",
        "keywords": [
          "backhand",
          "finger",
          "hand",
          "index",
          "left",
          "point",
          "pointing"
        ]
      },
      {
        "shortcode": "point_right",
        "glyph": "👉️",
        "keywords": [
          "backhand",
          "finger",
          "hand",
          "index",
          "point",
          "pointing",
          "right"
        ]
      },
      {
        "shortcode": "point_up_2",
        "glyph": "👆️",
        "keywords": [
          "backhand",
          "finger",
          "hand",
          "index",
          "point",
          "pointing",
          "up"
        ],
        "aliases": [
          "point_up"
        ]
      },
      {
        "shortcode": "fu",
        "glyph": "🖕",
        "keywords": [
          "finger",
          "hand",
          "middle"
        ],
        "aliases": [
          "middle_finger"
        ]
      },
      {
        "shortcode": "point_down",
        "glyph": "👇️",
        "keywords": [
          "backhand",
          "down",
          "finger",
          "hand",
          "index",
          "point",
          "pointing"
        ]
      },
      {
        "shortcode": "point_up",
        "glyph": "☝️",
        "keywords": [
          "finger",
          "hand",
          "index",
          "point",
          "pointing",
          "this",
          "up"
        ],
        "aliases": [
          "point_up_2"
        ]
      },
      {
        "shortcode": "index_pointing_at_the_viewer",
        "glyph": "🫵",
        "keywords": [
          "at",
          "finger",
          "hand",
          "index",
          "pointing",
          "poke",
          "viewer",
          "you"
        ],
        "aliases": [
          "point_forward"
        ]
      },
      {
        "shortcode": "+1",
        "glyph": "👍️",
        "keywords": [
          "+1",
          "good",
          "hand",
          "like",
          "thumb",
          "up",
          "yes"
        ],
        "aliases": [
          "thumbsup",
          "yes"
        ]
      },
      {
        "shortcode": "-1",
        "glyph": "👎️",
        "keywords": [
          "-1",
          "bad",
          "dislike",
          "down",
          "good",
          "hand",
          "no",
          "nope",
          "thumb",
          "thumbs"
        ],
        "aliases": [
          "thumbsdown",
          "no"
        ]
      },
      {
        "shortcode": "fist",
        "glyph": "✊️",
        "keywords": [
          "clenched",
          "fist",
          "hand",
          "punch",
          "raised",
          "solidarity"
        ],
        "aliases": [
          "fist_raised"
        ]
      },
      {
        "shortcode": "facepunch",
        "glyph": "👊",
        "keywords": [
          "absolutely",
          "agree",
          "boom",
          "bro",
          "bruh",
          "bump",
          "clenched",
          "correct",
          "fist",
          "hand",
          "knuckle",
          "oncoming",
          "pound",
          "punch",
          "rock",
          "ttyl"
        ],
        "aliases": [
          "fist_oncoming",
          "punch"
        ]
      },
      {
        "shortcode": "fist_left",
        "glyph": "🤛",
        "keywords": [
          "fist",
          "left-facing",
          "leftwards"
        ],
        "aliases": [
          "left_facing_fist"
        ]
      },
      {
        "shortcode": "fist_right",
        "glyph": "🤜",
        "keywords": [
          "fist",
          "right-facing",
          "rightwards"
        ],
        "aliases": [
          "right_facing_fist"
        ]
      },
      {
        "shortcode": "clap",
        "glyph": "👏",
        "keywords": [
          "applause",
          "approval",
          "awesome",
          "clap",
          "congrats",
          "congratulations",
          "excited",
          "good",
          "great",
          "hand",
          "homie",
          "job",
          "nice",
          "prayed",
          "well",
          "yay"
        ],
        "aliases": [
          "clapping_hands"
        ]
      },
      {
        "shortcode": "raised_hands",
        "glyph": "🙌",
        "keywords": [
          "celebration",
          "gesture",
          "hand",
          "hands",
          "hooray",
          "praise",
          "raised",
          "raising"
        ]
      },
      {
        "shortcode": "heart_hands",
        "glyph": "🫶",
        "keywords": [
          "<3",
          "hands",
          "heart",
          "love",
          "you"
        ]
      },
      {
        "shortcode": "open_hands",
        "glyph": "👐",
        "keywords": [
          "hand",
          "hands",
          "hug",
          "jazz",
          "open",
          "swerve"
        ]
      },
      {
        "shortcode": "palms_up_together",
        "glyph": "🤲",
        "keywords": [
          "cupped",
          "dua",
          "hands",
          "palms",
          "pray",
          "prayer",
          "together",
          "up",
          "wish"
        ]
      },
      {
        "shortcode": "handshake",
        "glyph": "🤝",
        "keywords": [
          "agreement",
          "deal",
          "hand",
          "meeting",
          "shake"
        ]
      },
      {
        "shortcode": "pray",
        "glyph": "🙏",
        "keywords": [
          "appreciate",
          "ask",
          "beg",
          "blessed",
          "bow",
          "cmon",
          "five",
          "folded",
          "gesture",
          "hand",
          "high",
          "please",
          "pray",
          "thanks",
          "thx"
        ],
        "aliases": [
          "folded_hands"
        ]
      },
      {
        "shortcode": "writing_hand",
        "glyph": "✍️",
        "keywords": [
          "hand",
          "write",
          "writing"
        ]
      },
      {
        "shortcode": "nail_care",
        "glyph": "💅",
        "keywords": [
          "bored",
          "care",
          "cosmetics",
          "done",
          "makeup",
          "manicure",
          "nail",
          "polish",
          "whatever"
        ],
        "aliases": [
          "nail_polish"
        ]
      },
      {
        "shortcode": "selfie",
        "glyph": "🤳",
        "keywords": [
          "camera",
          "phone"
        ]
      },
      {
        "shortcode": "muscle",
        "glyph": "💪",
        "keywords": [
          "arm",
          "beast",
          "bench",
          "biceps",
          "bodybuilder",
          "bro",
          "curls",
          "flex",
          "gains",
          "gym",
          "jacked",
          "muscle",
          "press",
          "ripped",
          "strong",
          "weightlift"
        ],
        "aliases": [
          "right_bicep"
        ]
      },
      {
        "shortcode": "mechanical_arm",
        "glyph": "🦾",
        "keywords": [
          "accessibility",
          "arm",
          "mechanical",
          "prosthetic"
        ]
      },
      {
        "shortcode": "mechanical_leg",
        "glyph": "🦿",
        "keywords": [
          "accessibility",
          "leg",
          "mechanical",
          "prosthetic"
        ]
      },
      {
        "shortcode": "leg",
        "glyph": "🦵",
        "keywords": [
          "bent",
          "foot",
          "kick",
          "knee",
          "limb"
        ]
      },
      {
        "shortcode": "foot",
        "glyph": "🦶",
        "keywords": [
          "ankle",
          "feet",
          "kick",
          "stomp"
        ]
      },
      {
        "shortcode": "ear",
        "glyph": "👂️",
        "keywords": [
          "body",
          "ears",
          "hear",
          "hearing",
          "listen",
          "listening",
          "sound"
        ]
      },
      {
        "shortcode": "ear_with_hearing_aid",
        "glyph": "🦻",
        "keywords": [
          "accessibility",
          "aid",
          "ear",
          "hard",
          "hearing"
        ],
        "aliases": [
          "hearing_aid"
        ]
      },
      {
        "shortcode": "nose",
        "glyph": "👃",
        "keywords": [
          "body",
          "noses",
          "nosey",
          "odor",
          "smell",
          "smells"
        ]
      },
      {
        "shortcode": "brain",
        "glyph": "🧠",
        "keywords": [
          "intelligent",
          "smart"
        ]
      },
      {
        "shortcode": "anatomical_heart",
        "glyph": "🫀",
        "keywords": [
          "anatomical",
          "beat",
          "cardiology",
          "heart",
          "heartbeat",
          "organ",
          "pulse",
          "real",
          "red"
        ]
      },
      {
        "shortcode": "lungs",
        "glyph": "🫁",
        "keywords": [
          "breath",
          "breathe",
          "exhalation",
          "inhalation",
          "lung",
          "organ",
          "respiration"
        ]
      },
      {
        "shortcode": "tooth",
        "glyph": "🦷",
        "keywords": [
          "dentist",
          "pearly",
          "teeth",
          "white"
        ]
      },
      {
        "shortcode": "bone",
        "glyph": "🦴",
        "keywords": [
          "bones",
          "dog",
          "skeleton",
          "wishbone"
        ]
      },
      {
        "shortcode": "eyes",
        "glyph": "👀",
        "keywords": [
          "body",
          "eye",
          "face",
          "googly",
          "look",
          "looking",
          "omg",
          "peep",
          "see",
          "seeing"
        ]
      },
      {
        "shortcode": "eye",
        "glyph": "👁️",
        "keywords": [
          "1",
          "body",
          "one"
        ]
      },
      {
        "shortcode": "tongue",
        "glyph": "👅",
        "keywords": [
          "body",
          "lick",
          "slurp"
        ]
      },
      {
        "shortcode": "lips",
        "glyph": "👄",
        "keywords": [
          "beauty",
          "body",
          "kiss",
          "kissing",
          "lips",
          "lipstick"
        ],
        "aliases": [
          "mouth"
        ]
      },
      {
        "shortcode": "biting_lip",
        "glyph": "🫦",
        "keywords": [
          "anxious",
          "bite",
          "biting",
          "fear",
          "flirt",
          "flirting",
          "kiss",
          "lip",
          "lipstick",
          "nervous",
          "sexy",
          "uncomfortable",
          "worried",
          "worry"
        ]
      },
      {
        "shortcode": "baby",
        "glyph": "👶",
        "keywords": [
          "babies",
          "children",
          "goo",
          "infant",
          "newborn",
          "pregnant",
          "young"
        ]
      },
      {
        "shortcode": "child",
        "glyph": "🧒",
        "keywords": [
          "bright-eyed",
          "grandchild",
          "kid",
          "young",
          "younger"
        ]
      },
      {
        "shortcode": "boy",
        "glyph": "👦",
        "keywords": [
          "bright-eyed",
          "child",
          "grandson",
          "kid",
          "son",
          "young",
          "younger"
        ]
      },
      {
        "shortcode": "girl",
        "glyph": "👧",
        "keywords": [
          "bright-eyed",
          "child",
          "daughter",
          "granddaughter",
          "kid",
          "virgo",
          "young",
          "younger",
          "zodiac"
        ]
      },
      {
        "shortcode": "adult",
        "glyph": "🧑",
        "keywords": [
          "adult"
        ]
      },
      {
        "shortcode": "blond_haired_person",
        "glyph": "👱",
        "keywords": [
          "blond",
          "blond-haired",
          "human",
          "person"
        ],
        "aliases": [
          "blond_haired"
        ]
      },
      {
        "shortcode": "man",
        "glyph": "👨",
        "keywords": [
          "adult",
          "bro"
        ]
      },
      {
        "shortcode": "bearded_person",
        "glyph": "🧔",
        "keywords": [
          "beard",
          "bearded",
          "person",
          "whiskers"
        ],
        "aliases": [
          "person_bearded"
        ]
      },
      {
        "shortcode": "man_beard",
        "glyph": "🧔‍♂️",
        "keywords": [
          "beard",
          "bearded",
          "man",
          "whiskers"
        ],
        "aliases": [
          "man_bearded"
        ]
      },
      {
        "shortcode": "woman_beard",
        "glyph": "🧔‍♀️",
        "keywords": [
          "beard",
          "bearded",
          "whiskers",
          "woman"
        ],
        "aliases": [
          "woman_bearded"
        ]
      },
      {
        "shortcode": "red_haired_man",
        "glyph": "👨‍🦰",
        "keywords": [
          "adult",
          "bro",
          "man",
          "red hair"
        ],
        "aliases": [
          "man_red_haired"
        ]
      },
      {
        "shortcode": "curly_haired_man",
        "glyph": "👨‍🦱",
        "keywords": [
          "adult",
          "bro",
          "curly hair",
          "man"
        ],
        "aliases": [
          "man_curly_haired"
        ]
      },
      {
        "shortcode": "white_haired_man",
        "glyph": "👨‍🦳",
        "keywords": [
          "adult",
          "bro",
          "man",
          "white hair"
        ],
        "aliases": [
          "man_white_haired"
        ]
      },
      {
        "shortcode": "bald_man",
        "glyph": "👨‍🦲",
        "keywords": [
          "adult",
          "bald",
          "bro",
          "man"
        ],
        "aliases": [
          "man_bald"
        ]
      },
      {
        "shortcode": "woman",
        "glyph": "👩",
        "keywords": [
          "adult",
          "lady"
        ]
      },
      {
        "shortcode": "red_haired_woman",
        "glyph": "👩‍🦰",
        "keywords": [
          "adult",
          "lady",
          "red hair",
          "woman"
        ],
        "aliases": [
          "woman_red_haired"
        ]
      },
      {
        "shortcode": "person_red_hair",
        "glyph": "🧑‍🦰",
        "keywords": [
          "adult",
          "person",
          "red hair"
        ],
        "aliases": [
          "red_haired"
        ]
      },
      {
        "shortcode": "curly_haired_woman",
        "glyph": "👩‍🦱",
        "keywords": [
          "adult",
          "curly hair",
          "lady",
          "woman"
        ],
        "aliases": [
          "woman_curly_haired"
        ]
      },
      {
        "shortcode": "person_curly_hair",
        "glyph": "🧑‍🦱",
        "keywords": [
          "adult",
          "curly hair",
          "person"
        ],
        "aliases": [
          "curly_haired"
        ]
      },
      {
        "shortcode": "white_haired_woman",
        "glyph": "👩‍🦳",
        "keywords": [
          "adult",
          "lady",
          "white hair",
          "woman"
        ],
        "aliases": [
          "woman_white_haired"
        ]
      },
      {
        "shortcode": "person_white_hair",
        "glyph": "🧑‍🦳",
        "keywords": [
          "adult",
          "person",
          "white hair"
        ],
        "aliases": [
          "white_haired"
        ]
      },
      {
        "shortcode": "bald_woman",
        "glyph": "👩‍🦲",
        "keywords": [
          "adult",
          "bald",
          "lady",
          "woman"
        ],
        "aliases": [
          "woman_bald"
        ]
      },
      {
        "shortcode": "person_bald",
        "glyph": "🧑‍🦲",
        "keywords": [
          "adult",
          "bald",
          "person"
        ],
        "aliases": [
          "bald"
        ]
      },
      {
        "shortcode": "blond_haired_woman",
        "glyph": "👱‍♀️",
        "keywords": [
          "blond",
          "blond-haired",
          "blonde",
          "hair",
          "woman"
        ],
        "aliases": [
          "blonde_woman",
          "woman_blond_haired"
        ]
      },
      {
        "shortcode": "blond_haired_man",
        "glyph": "👱‍♂️",
        "keywords": [
          "blond",
          "blond-haired",
          "hair",
          "man"
        ],
        "aliases": [
          "man_blond_haired"
        ]
      },
      {
        "shortcode": "older_adult",
        "glyph": "🧓",
        "keywords": [
          "adult",
          "elderly",
          "grandparent",
          "old",
          "person",
          "wise"
        ]
      },
      {
        "shortcode": "older_man",
        "glyph": "👴",
        "keywords": [
          "adult",
          "bald",
          "elderly",
          "gramps",
          "grandfather",
          "grandpa",
          "man",
          "old",
          "wise"
        ]
      },
      {
        "shortcode": "older_woman",
        "glyph": "👵",
        "keywords": [
          "adult",
          "elderly",
          "grandma",
          "grandmother",
          "granny",
          "lady",
          "old",
          "wise",
          "woman"
        ]
      },
      {
        "shortcode": "frowning_person",
        "glyph": "🙍",
        "keywords": [
          "annoyed",
          "disappointed",
          "disgruntled",
          "disturbed",
          "frown",
          "frowning",
          "frustrated",
          "gesture",
          "irritated",
          "person",
          "upset"
        ],
        "aliases": [
          "person_frowning"
        ]
      },
      {
        "shortcode": "frowning_man",
        "glyph": "🙍‍♂️",
        "keywords": [
          "annoyed",
          "disappointed",
          "disgruntled",
          "disturbed",
          "frown",
          "frowning",
          "frustrated",
          "gesture",
          "irritated",
          "man",
          "upset"
        ],
        "aliases": [
          "man_frowning"
        ]
      },
      {
        "shortcode": "frowning_woman",
        "glyph": "🙍‍♀️",
        "keywords": [
          "annoyed",
          "disappointed",
          "disgruntled",
          "disturbed",
          "frown",
          "frowning",
          "frustrated",
          "gesture",
          "irritated",
          "upset",
          "woman"
        ],
        "aliases": [
          "woman_frowning"
        ]
      },
      {
        "shortcode": "pouting_face",
        "glyph": "🙎",
        "keywords": [
          "disappointed",
          "downtrodden",
          "frown",
          "grimace",
          "person",
          "pouting",
          "scowl",
          "sulk",
          "upset",
          "whine"
        ],
        "aliases": [
          "person_pouting",
          "pouting"
        ]
      },
      {
        "shortcode": "pouting_man",
        "glyph": "🙎‍♂️",
        "keywords": [
          "disappointed",
          "downtrodden",
          "frown",
          "grimace",
          "man",
          "pouting",
          "scowl",
          "sulk",
          "upset",
          "whine"
        ],
        "aliases": [
          "man_pouting"
        ]
      },
      {
        "shortcode": "pouting_woman",
        "glyph": "🙎‍♀️",
        "keywords": [
          "disappointed",
          "downtrodden",
          "frown",
          "grimace",
          "pouting",
          "scowl",
          "sulk",
          "upset",
          "whine",
          "woman"
        ],
        "aliases": [
          "woman_pouting"
        ]
      },
      {
        "shortcode": "no_good",
        "glyph": "🙅",
        "keywords": [
          "forbidden",
          "gesture",
          "hand",
          "no",
          "not",
          "person",
          "prohibit"
        ],
        "aliases": [
          "person_gesturing_no"
        ]
      },
      {
        "shortcode": "ng_man",
        "glyph": "🙅‍♂️",
        "keywords": [
          "forbidden",
          "gesture",
          "hand",
          "man",
          "no",
          "not",
          "prohibit"
        ],
        "aliases": [
          "no_good_man",
          "man_gesturing_no"
        ]
      },
      {
        "shortcode": "ng_woman",
        "glyph": "🙅‍♀️",
        "keywords": [
          "forbidden",
          "gesture",
          "hand",
          "no",
          "not",
          "prohibit",
          "woman"
        ],
        "aliases": [
          "no_good_woman",
          "woman_gesturing_no"
        ]
      },
      {
        "shortcode": "ok_person",
        "glyph": "🙆",
        "keywords": [
          "exercise",
          "gesture",
          "gesturing",
          "hand",
          "ok",
          "omg",
          "person"
        ],
        "aliases": [
          "all_good",
          "person_gesturing_ok"
        ]
      },
      {
        "shortcode": "ok_man",
        "glyph": "🙆‍♂️",
        "keywords": [
          "exercise",
          "gesture",
          "gesturing",
          "hand",
          "man",
          "ok",
          "omg"
        ],
        "aliases": [
          "man_gesturing_ok"
        ]
      },
      {
        "shortcode": "ok_woman",
        "glyph": "🙆‍♀️",
        "keywords": [
          "exercise",
          "gesture",
          "gesturing",
          "hand",
          "ok",
          "omg",
          "woman"
        ],
        "aliases": [
          "woman_gesturing_ok"
        ]
      },
      {
        "shortcode": "information_desk_person",
        "glyph": "💁",
        "keywords": [
          "fetch",
          "flick",
          "flip",
          "gossip",
          "hand",
          "person",
          "sarcasm",
          "sarcastic",
          "sassy",
          "seriously",
          "tipping",
          "whatever"
        ],
        "aliases": [
          "tipping_hand_person",
          "person_tipping_hand"
        ]
      },
      {
        "shortcode": "sassy_man",
        "glyph": "💁‍♂️",
        "keywords": [
          "fetch",
          "flick",
          "flip",
          "gossip",
          "hand",
          "man",
          "sarcasm",
          "sarcastic",
          "sassy",
          "seriously",
          "tipping",
          "whatever"
        ],
        "aliases": [
          "tipping_hand_man",
          "man_tipping_hand"
        ]
      },
      {
        "shortcode": "sassy_woman",
        "glyph": "💁‍♀️",
        "keywords": [
          "fetch",
          "flick",
          "flip",
          "gossip",
          "hand",
          "sarcasm",
          "sarcastic",
          "sassy",
          "seriously",
          "tipping",
          "whatever",
          "woman"
        ],
        "aliases": [
          "tipping_hand_woman",
          "woman_tipping_hand"
        ]
      },
      {
        "shortcode": "raising_hand",
        "glyph": "🙋",
        "keywords": [
          "gesture",
          "hand",
          "here",
          "know",
          "me",
          "person",
          "pick",
          "question",
          "raise",
          "raising"
        ],
        "aliases": [
          "person_raising_hand"
        ]
      },
      {
        "shortcode": "raising_hand_man",
        "glyph": "🙋‍♂️",
        "keywords": [
          "gesture",
          "hand",
          "here",
          "know",
          "man",
          "me",
          "pick",
          "question",
          "raise",
          "raising"
        ],
        "aliases": [
          "man_raising_hand"
        ]
      },
      {
        "shortcode": "raising_hand_woman",
        "glyph": "🙋‍♀️",
        "keywords": [
          "gesture",
          "hand",
          "here",
          "know",
          "me",
          "pick",
          "question",
          "raise",
          "raising",
          "woman"
        ],
        "aliases": [
          "woman_raising_hand"
        ]
      },
      {
        "shortcode": "deaf_person",
        "glyph": "🧏",
        "keywords": [
          "accessibility",
          "deaf",
          "ear",
          "gesture",
          "hear",
          "person"
        ]
      },
      {
        "shortcode": "deaf_man",
        "glyph": "🧏‍♂️",
        "keywords": [
          "accessibility",
          "deaf",
          "ear",
          "gesture",
          "hear",
          "man"
        ]
      },
      {
        "shortcode": "deaf_woman",
        "glyph": "🧏‍♀️",
        "keywords": [
          "accessibility",
          "deaf",
          "ear",
          "gesture",
          "hear",
          "woman"
        ]
      },
      {
        "shortcode": "bow",
        "glyph": "🙇",
        "keywords": [
          "apology",
          "ask",
          "beg",
          "bow",
          "bowing",
          "favor",
          "forgive",
          "gesture",
          "meditate",
          "meditation",
          "person",
          "pity",
          "regret",
          "sorry"
        ],
        "aliases": [
          "person_bowing"
        ]
      },
      {
        "shortcode": "bowing_man",
        "glyph": "🙇‍♂️",
        "keywords": [
          "apology",
          "ask",
          "beg",
          "bow",
          "bowing",
          "favor",
          "forgive",
          "gesture",
          "man",
          "meditate",
          "meditation",
          "pity",
          "regret",
          "sorry"
        ],
        "aliases": [
          "man_bowing"
        ]
      },
      {
        "shortcode": "bowing_woman",
        "glyph": "🙇‍♀️",
        "keywords": [
          "apology",
          "ask",
          "beg",
          "bow",
          "bowing",
          "favor",
          "forgive",
          "gesture",
          "meditate",
          "meditation",
          "pity",
          "regret",
          "sorry",
          "woman"
        ],
        "aliases": [
          "woman_bowing"
        ]
      },
      {
        "shortcode": "facepalm",
        "glyph": "🤦",
        "keywords": [
          "again",
          "bewilder",
          "disbelief",
          "exasperation",
          "facepalm",
          "no",
          "not",
          "oh",
          "omg",
          "person",
          "shock",
          "smh"
        ],
        "aliases": [
          "person_facepalming"
        ]
      },
      {
        "shortcode": "man_facepalming",
        "glyph": "🤦‍♂️",
        "keywords": [
          "again",
          "bewilder",
          "disbelief",
          "exasperation",
          "facepalm",
          "man",
          "no",
          "not",
          "oh",
          "omg",
          "shock",
          "smh"
        ]
      },
      {
        "shortcode": "woman_facepalming",
        "glyph": "🤦‍♀️",
        "keywords": [
          "again",
          "bewilder",
          "disbelief",
          "exasperation",
          "facepalm",
          "no",
          "not",
          "oh",
          "omg",
          "shock",
          "smh",
          "woman"
        ]
      },
      {
        "shortcode": "shrug",
        "glyph": "🤷",
        "keywords": [
          "doubt",
          "dunno",
          "guess",
          "idk",
          "ignorance",
          "indifference",
          "knows",
          "maybe",
          "person",
          "shrug",
          "shrugging",
          "whatever",
          "who"
        ],
        "aliases": [
          "person_shrugging"
        ]
      },
      {
        "shortcode": "man_shrugging",
        "glyph": "🤷‍♂️",
        "keywords": [
          "doubt",
          "dunno",
          "guess",
          "idk",
          "ignorance",
          "indifference",
          "knows",
          "man",
          "maybe",
          "shrug",
          "shrugging",
          "whatever",
          "who"
        ]
      },
      {
        "shortcode": "woman_shrugging",
        "glyph": "🤷‍♀️",
        "keywords": [
          "doubt",
          "dunno",
          "guess",
          "idk",
          "ignorance",
          "indifference",
          "knows",
          "maybe",
          "shrug",
          "shrugging",
          "whatever",
          "who",
          "woman"
        ]
      },
      {
        "shortcode": "health_worker",
        "glyph": "🧑‍⚕️",
        "keywords": [
          "doctor",
          "health",
          "healthcare",
          "nurse",
          "therapist",
          "worker"
        ]
      },
      {
        "shortcode": "man_health_worker",
        "glyph": "👨‍⚕️",
        "keywords": [
          "doctor",
          "health",
          "healthcare",
          "man",
          "nurse",
          "therapist",
          "worker"
        ]
      },
      {
        "shortcode": "woman_health_worker",
        "glyph": "👩‍⚕️",
        "keywords": [
          "doctor",
          "health",
          "healthcare",
          "nurse",
          "therapist",
          "woman",
          "worker"
        ]
      },
      {
        "shortcode": "student",
        "glyph": "🧑‍🎓",
        "keywords": [
          "graduate"
        ]
      },
      {
        "shortcode": "man_student",
        "glyph": "👨‍🎓",
        "keywords": [
          "graduate",
          "man",
          "student"
        ]
      },
      {
        "shortcode": "woman_student",
        "glyph": "👩‍🎓",
        "keywords": [
          "graduate",
          "student",
          "woman"
        ]
      },
      {
        "shortcode": "teacher",
        "glyph": "🧑‍🏫",
        "keywords": [
          "instructor",
          "lecturer",
          "professor"
        ]
      },
      {
        "shortcode": "man_teacher",
        "glyph": "👨‍🏫",
        "keywords": [
          "instructor",
          "lecturer",
          "man",
          "professor",
          "teacher"
        ]
      },
      {
        "shortcode": "woman_teacher",
        "glyph": "👩‍🏫",
        "keywords": [
          "instructor",
          "lecturer",
          "professor",
          "teacher",
          "woman"
        ]
      },
      {
        "shortcode": "judge",
        "glyph": "🧑‍⚖️",
        "keywords": [
          "justice",
          "law",
          "scales"
        ]
      },
      {
        "shortcode": "man_judge",
        "glyph": "👨‍⚖️",
        "keywords": [
          "judge",
          "justice",
          "law",
          "man",
          "scales"
        ]
      },
      {
        "shortcode": "woman_judge",
        "glyph": "👩‍⚖️",
        "keywords": [
          "judge",
          "justice",
          "law",
          "scales",
          "woman"
        ]
      },
      {
        "shortcode": "farmer",
        "glyph": "🧑‍🌾",
        "keywords": [
          "gardener",
          "rancher"
        ]
      },
      {
        "shortcode": "man_farmer",
        "glyph": "👨‍🌾",
        "keywords": [
          "farmer",
          "gardener",
          "man",
          "rancher"
        ]
      },
      {
        "shortcode": "woman_farmer",
        "glyph": "👩‍🌾",
        "keywords": [
          "farmer",
          "gardener",
          "rancher",
          "woman"
        ]
      },
      {
        "shortcode": "cook",
        "glyph": "🧑‍🍳",
        "keywords": [
          "chef"
        ]
      },
      {
        "shortcode": "man_cook",
        "glyph": "👨‍🍳",
        "keywords": [
          "chef",
          "cook",
          "man"
        ]
      },
      {
        "shortcode": "woman_cook",
        "glyph": "👩‍🍳",
        "keywords": [
          "chef",
          "cook",
          "woman"
        ]
      },
      {
        "shortcode": "mechanic",
        "glyph": "🧑‍🔧",
        "keywords": [
          "electrician",
          "plumber",
          "tradesperson"
        ]
      },
      {
        "shortcode": "man_mechanic",
        "glyph": "👨‍🔧",
        "keywords": [
          "electrician",
          "man",
          "mechanic",
          "plumber",
          "tradesperson"
        ]
      },
      {
        "shortcode": "woman_mechanic",
        "glyph": "👩‍🔧",
        "keywords": [
          "electrician",
          "mechanic",
          "plumber",
          "tradesperson",
          "woman"
        ]
      },
      {
        "shortcode": "factory_worker",
        "glyph": "🧑‍🏭",
        "keywords": [
          "assembly",
          "factory",
          "industrial",
          "worker"
        ]
      },
      {
        "shortcode": "man_factory_worker",
        "glyph": "👨‍🏭",
        "keywords": [
          "assembly",
          "factory",
          "industrial",
          "man",
          "worker"
        ]
      },
      {
        "shortcode": "woman_factory_worker",
        "glyph": "👩‍🏭",
        "keywords": [
          "assembly",
          "factory",
          "industrial",
          "woman",
          "worker"
        ]
      },
      {
        "shortcode": "office_worker",
        "glyph": "🧑‍💼",
        "keywords": [
          "architect",
          "business",
          "manager",
          "office",
          "white-collar",
          "worker"
        ]
      },
      {
        "shortcode": "man_office_worker",
        "glyph": "👨‍💼",
        "keywords": [
          "architect",
          "business",
          "man",
          "manager",
          "office",
          "white-collar",
          "worker"
        ]
      },
      {
        "shortcode": "woman_office_worker",
        "glyph": "👩‍💼",
        "keywords": [
          "architect",
          "business",
          "manager",
          "office",
          "white-collar",
          "woman",
          "worker"
        ]
      },
      {
        "shortcode": "scientist",
        "glyph": "🧑‍🔬",
        "keywords": [
          "biologist",
          "chemist",
          "engineer",
          "mathematician",
          "physicist"
        ]
      },
      {
        "shortcode": "man_scientist",
        "glyph": "👨‍🔬",
        "keywords": [
          "biologist",
          "chemist",
          "engineer",
          "man",
          "mathematician",
          "physicist",
          "scientist"
        ]
      },
      {
        "shortcode": "woman_scientist",
        "glyph": "👩‍🔬",
        "keywords": [
          "biologist",
          "chemist",
          "engineer",
          "mathematician",
          "physicist",
          "scientist",
          "woman"
        ]
      },
      {
        "shortcode": "technologist",
        "glyph": "🧑‍💻",
        "keywords": [
          "coder",
          "computer",
          "developer",
          "inventor",
          "software"
        ]
      },
      {
        "shortcode": "man_technologist",
        "glyph": "👨‍💻",
        "keywords": [
          "coder",
          "computer",
          "developer",
          "inventor",
          "man",
          "software",
          "technologist"
        ]
      },
      {
        "shortcode": "woman_technologist",
        "glyph": "👩‍💻",
        "keywords": [
          "coder",
          "computer",
          "developer",
          "inventor",
          "software",
          "technologist",
          "woman"
        ]
      },
      {
        "shortcode": "singer",
        "glyph": "🧑‍🎤",
        "keywords": [
          "actor",
          "entertainer",
          "rock",
          "rockstar",
          "star"
        ]
      },
      {
        "shortcode": "man_singer",
        "glyph": "👨‍🎤",
        "keywords": [
          "actor",
          "entertainer",
          "man",
          "rock",
          "rockstar",
          "singer",
          "star"
        ]
      },
      {
        "shortcode": "woman_singer",
        "glyph": "👩‍🎤",
        "keywords": [
          "actor",
          "entertainer",
          "rock",
          "rockstar",
          "singer",
          "star",
          "woman"
        ]
      },
      {
        "shortcode": "artist",
        "glyph": "🧑‍🎨",
        "keywords": [
          "palette"
        ]
      },
      {
        "shortcode": "man_artist",
        "glyph": "👨‍🎨",
        "keywords": [
          "artist",
          "man",
          "palette"
        ]
      },
      {
        "shortcode": "woman_artist",
        "glyph": "👩‍🎨",
        "keywords": [
          "artist",
          "palette",
          "woman"
        ]
      },
      {
        "shortcode": "pilot",
        "glyph": "🧑‍✈️",
        "keywords": [
          "plane"
        ]
      },
      {
        "shortcode": "man_pilot",
        "glyph": "👨‍✈️",
        "keywords": [
          "man",
          "pilot",
          "plane"
        ]
      },
      {
        "shortcode": "woman_pilot",
        "glyph": "👩‍✈️",
        "keywords": [
          "pilot",
          "plane",
          "woman"
        ]
      },
      {
        "shortcode": "astronaut",
        "glyph": "🧑‍🚀",
        "keywords": [
          "rocket",
          "space"
        ]
      },
      {
        "shortcode": "man_astronaut",
        "glyph": "👨‍🚀",
        "keywords": [
          "astronaut",
          "man",
          "rocket",
          "space"
        ]
      },
      {
        "shortcode": "woman_astronaut",
        "glyph": "👩‍🚀",
        "keywords": [
          "astronaut",
          "rocket",
          "space",
          "woman"
        ]
      },
      {
        "shortcode": "firefighter",
        "glyph": "🧑‍🚒",
        "keywords": [
          "fire",
          "firetruck"
        ]
      },
      {
        "shortcode": "man_firefighter",
        "glyph": "👨‍🚒",
        "keywords": [
          "fire",
          "firefighter",
          "firetruck",
          "man"
        ]
      },
      {
        "shortcode": "woman_firefighter",
        "glyph": "👩‍🚒",
        "keywords": [
          "fire",
          "firefighter",
          "firetruck",
          "woman"
        ]
      },
      {
        "shortcode": "cop",
        "glyph": "👮",
        "keywords": [
          "apprehend",
          "arrest",
          "citation",
          "cop",
          "law",
          "officer",
          "over",
          "police",
          "pulled",
          "undercover"
        ],
        "aliases": [
          "police_officer"
        ]
      },
      {
        "shortcode": "policeman",
        "glyph": "👮‍♂️",
        "keywords": [
          "apprehend",
          "arrest",
          "citation",
          "cop",
          "law",
          "man",
          "officer",
          "over",
          "police",
          "pulled",
          "undercover"
        ],
        "aliases": [
          "man_police_officer"
        ]
      },
      {
        "shortcode": "policewoman",
        "glyph": "👮‍♀️",
        "keywords": [
          "apprehend",
          "arrest",
          "citation",
          "cop",
          "law",
          "officer",
          "over",
          "police",
          "pulled",
          "undercover",
          "woman"
        ],
        "aliases": [
          "woman_police_officer"
        ]
      },
      {
        "shortcode": "detective",
        "glyph": "🕵️",
        "keywords": [
          "sleuth",
          "spy"
        ]
      },
      {
        "shortcode": "male_detective",
        "glyph": "🕵️‍♂️",
        "keywords": [
          "detective",
          "man",
          "sleuth",
          "spy"
        ],
        "aliases": [
          "man_detective"
        ]
      },
      {
        "shortcode": "female_detective",
        "glyph": "🕵️‍♀️",
        "keywords": [
          "detective",
          "sleuth",
          "spy",
          "woman"
        ],
        "aliases": [
          "woman_detective"
        ]
      },
      {
        "shortcode": "guard",
        "glyph": "💂",
        "keywords": [
          "buckingham",
          "helmet",
          "london",
          "palace"
        ]
      },
      {
        "shortcode": "guardsman",
        "glyph": "💂‍♂️",
        "keywords": [
          "buckingham",
          "guard",
          "helmet",
          "london",
          "man",
          "palace"
        ],
        "aliases": [
          "man_guard"
        ]
      },
      {
        "shortcode": "guardswoman",
        "glyph": "💂‍♀️",
        "keywords": [
          "buckingham",
          "guard",
          "helmet",
          "london",
          "palace",
          "woman"
        ],
        "aliases": [
          "woman_guard"
        ]
      },
      {
        "shortcode": "ninja",
        "glyph": "🥷",
        "keywords": [
          "assassin",
          "fight",
          "fighter",
          "hidden",
          "person",
          "secret",
          "skills",
          "sly",
          "soldier",
          "stealth",
          "war"
        ]
      },
      {
        "shortcode": "construction_worker",
        "glyph": "👷",
        "keywords": [
          "build",
          "construction",
          "fix",
          "hardhat",
          "hat",
          "man",
          "person",
          "rebuild",
          "remodel",
          "repair",
          "work",
          "worker"
        ]
      },
      {
        "shortcode": "construction_worker_man",
        "glyph": "👷‍♂️",
        "keywords": [
          "build",
          "construction",
          "fix",
          "hardhat",
          "hat",
          "man",
          "rebuild",
          "remodel",
          "repair",
          "work",
          "worker"
        ],
        "aliases": [
          "man_construction_worker"
        ]
      },
      {
        "shortcode": "construction_worker_woman",
        "glyph": "👷‍♀️",
        "keywords": [
          "build",
          "construction",
          "fix",
          "hardhat",
          "hat",
          "man",
          "rebuild",
          "remodel",
          "repair",
          "woman",
          "work",
          "worker"
        ],
        "aliases": [
          "woman_construction_worker"
        ]
      },
      {
        "shortcode": "person_with_crown",
        "glyph": "🫅",
        "keywords": [
          "crown",
          "monarch",
          "noble",
          "person",
          "regal",
          "royal",
          "royalty"
        ],
        "aliases": [
          "royalty"
        ]
      },
      {
        "shortcode": "prince",
        "glyph": "🤴",
        "keywords": [
          "crown",
          "fairy",
          "fairytale",
          "fantasy",
          "king",
          "royal",
          "royalty",
          "tale"
        ]
      },
      {
        "shortcode": "princess",
        "glyph": "👸",
        "keywords": [
          "crown",
          "fairy",
          "fairytale",
          "fantasy",
          "queen",
          "royal",
          "royalty",
          "tale"
        ]
      },
      {
        "shortcode": "person_with_turban",
        "glyph": "👳",
        "keywords": [
          "person",
          "turban",
          "wearing"
        ],
        "aliases": [
          "person_wearing_turban"
        ]
      },
      {
        "shortcode": "man_with_turban",
        "glyph": "👳‍♂️",
        "keywords": [
          "man",
          "turban",
          "wearing"
        ],
        "aliases": [
          "man_wearing_turban"
        ]
      },
      {
        "shortcode": "woman_with_turban",
        "glyph": "👳‍♀️",
        "keywords": [
          "turban",
          "wearing",
          "woman"
        ],
        "aliases": [
          "woman_wearing_turban"
        ]
      },
      {
        "shortcode": "man_with_gua_pi_mao",
        "glyph": "👲",
        "keywords": [
          "cap",
          "chinese",
          "gua",
          "guapi",
          "hat",
          "mao",
          "person",
          "pi",
          "skullcap"
        ],
        "aliases": [
          "person_with_skullcap"
        ]
      },
      {
        "shortcode": "woman_with_headscarf",
        "glyph": "🧕",
        "keywords": [
          "bandana",
          "head",
          "headscarf",
          "hijab",
          "kerchief",
          "mantilla",
          "tichel",
          "woman"
        ]
      },
      {
        "shortcode": "person_in_tuxedo",
        "glyph": "🤵",
        "keywords": [
          "formal",
          "person",
          "tuxedo",
          "wedding"
        ]
      },
      {
        "shortcode": "man_in_tuxedo",
        "glyph": "🤵‍♂️",
        "keywords": [
          "formal",
          "groom",
          "man",
          "tuxedo",
          "wedding"
        ]
      },
      {
        "shortcode": "woman_in_tuxedo",
        "glyph": "🤵‍♀️",
        "keywords": [
          "formal",
          "tuxedo",
          "wedding",
          "woman"
        ]
      },
      {
        "shortcode": "person_with_veil",
        "glyph": "👰",
        "keywords": [
          "person",
          "veil",
          "wedding"
        ]
      },
      {
        "shortcode": "man_with_veil",
        "glyph": "👰‍♂️",
        "keywords": [
          "man",
          "veil",
          "wedding"
        ]
      },
      {
        "shortcode": "bride_with_veil",
        "glyph": "👰‍♀️",
        "keywords": [
          "bride",
          "veil",
          "wedding",
          "woman"
        ],
        "aliases": [
          "woman_with_veil"
        ]
      },
      {
        "shortcode": "pregnant_woman",
        "glyph": "🤰",
        "keywords": [
          "pregnant",
          "woman"
        ]
      },
      {
        "shortcode": "pregnant_man",
        "glyph": "🫃",
        "keywords": [
          "belly",
          "bloated",
          "full",
          "man",
          "overeat",
          "pregnant"
        ]
      },
      {
        "shortcode": "pregnant_person",
        "glyph": "🫄",
        "keywords": [
          "belly",
          "bloated",
          "full",
          "overeat",
          "person",
          "pregnant",
          "stuffed"
        ]
      },
      {
        "shortcode": "breast_feeding",
        "glyph": "🤱",
        "keywords": [
          "baby",
          "breast",
          "feeding",
          "mom",
          "mother",
          "nursing",
          "woman"
        ]
      },
      {
        "shortcode": "woman_feeding_baby",
        "glyph": "👩‍🍼",
        "keywords": [
          "baby",
          "feed",
          "feeding",
          "mom",
          "mother",
          "nanny",
          "newborn",
          "nursing",
          "woman"
        ]
      },
      {
        "shortcode": "man_feeding_baby",
        "glyph": "👨‍🍼",
        "keywords": [
          "baby",
          "dad",
          "father",
          "feed",
          "feeding",
          "man",
          "nanny",
          "newborn",
          "nursing"
        ]
      },
      {
        "shortcode": "person_feeding_baby",
        "glyph": "🧑‍🍼",
        "keywords": [
          "baby",
          "feed",
          "feeding",
          "nanny",
          "newborn",
          "nursing",
          "parent"
        ]
      },
      {
        "shortcode": "angel",
        "glyph": "👼",
        "keywords": [
          "angel",
          "baby",
          "church",
          "face",
          "fairy",
          "fairytale",
          "fantasy",
          "tale"
        ]
      },
      {
        "shortcode": "santa",
        "glyph": "🎅",
        "keywords": [
          "celebration",
          "christmas",
          "claus",
          "fairy",
          "fantasy",
          "father",
          "holiday",
          "merry",
          "santa",
          "tale",
          "xmas"
        ]
      },
      {
        "shortcode": "mrs_claus",
        "glyph": "🤶",
        "keywords": [
          "celebration",
          "christmas",
          "claus",
          "fairy",
          "fantasy",
          "holiday",
          "merry",
          "mother",
          "mrs",
          "santa",
          "tale",
          "xmas"
        ]
      },
      {
        "shortcode": "mx_claus",
        "glyph": "🧑‍🎄",
        "keywords": [
          "celebration",
          "christmas",
          "claus",
          "fairy",
          "fantasy",
          "holiday",
          "merry",
          "mx",
          "santa",
          "tale",
          "xmas"
        ]
      },
      {
        "shortcode": "superhero",
        "glyph": "🦸",
        "keywords": [
          "good",
          "hero",
          "superpower"
        ]
      },
      {
        "shortcode": "superhero_man",
        "glyph": "🦸‍♂️",
        "keywords": [
          "good",
          "hero",
          "man",
          "superhero",
          "superpower"
        ],
        "aliases": [
          "man_superhero"
        ]
      },
      {
        "shortcode": "superhero_woman",
        "glyph": "🦸‍♀️",
        "keywords": [
          "good",
          "hero",
          "heroine",
          "superhero",
          "superpower",
          "woman"
        ],
        "aliases": [
          "woman_superhero"
        ]
      },
      {
        "shortcode": "supervillain",
        "glyph": "🦹",
        "keywords": [
          "bad",
          "criminal",
          "evil",
          "superpower",
          "villain"
        ]
      },
      {
        "shortcode": "supervillain_man",
        "glyph": "🦹‍♂️",
        "keywords": [
          "bad",
          "criminal",
          "evil",
          "man",
          "superpower",
          "supervillain",
          "villain"
        ],
        "aliases": [
          "man_supervillain"
        ]
      },
      {
        "shortcode": "supervillain_woman",
        "glyph": "🦹‍♀️",
        "keywords": [
          "bad",
          "criminal",
          "evil",
          "superpower",
          "supervillain",
          "villain",
          "woman"
        ],
        "aliases": [
          "woman_supervillain"
        ]
      },
      {
        "shortcode": "mage",
        "glyph": "🧙",
        "keywords": [
          "fantasy",
          "magic",
          "play",
          "sorcerer",
          "sorceress",
          "sorcery",
          "spell",
          "summon",
          "witch",
          "wizard"
        ]
      },
      {
        "shortcode": "mage_man",
        "glyph": "🧙‍♂️",
        "keywords": [
          "fantasy",
          "mage",
          "magic",
          "man",
          "play",
          "sorcerer",
          "sorceress",
          "sorcery",
          "spell",
          "summon",
          "witch",
          "wizard"
        ],
        "aliases": [
          "man_mage"
        ]
      },
      {
        "shortcode": "mage_woman",
        "glyph": "🧙‍♀️",
        "keywords": [
          "fantasy",
          "mage",
          "magic",
          "play",
          "sorcerer",
          "sorceress",
          "sorcery",
          "spell",
          "summon",
          "witch",
          "wizard",
          "woman"
        ],
        "aliases": [
          "woman_mage"
        ]
      },
      {
        "shortcode": "fairy",
        "glyph": "🧚",
        "keywords": [
          "fairytale",
          "fantasy",
          "myth",
          "person",
          "pixie",
          "tale",
          "wings"
        ]
      },
      {
        "shortcode": "fairy_man",
        "glyph": "🧚‍♂️",
        "keywords": [
          "fairy",
          "fairytale",
          "fantasy",
          "man",
          "myth",
          "oberon",
          "person",
          "pixie",
          "puck",
          "tale",
          "wings"
        ],
        "aliases": [
          "man_fairy"
        ]
      },
      {
        "shortcode": "fairy_woman",
        "glyph": "🧚‍♀️",
        "keywords": [
          "fairy",
          "fairytale",
          "fantasy",
          "myth",
          "person",
          "pixie",
          "tale",
          "titania",
          "wings",
          "woman"
        ],
        "aliases": [
          "woman_fairy"
        ]
      },
      {
        "shortcode": "vampire",
        "glyph": "🧛",
        "keywords": [
          "blood",
          "dracula",
          "fangs",
          "halloween",
          "scary",
          "supernatural",
          "teeth",
          "undead"
        ]
      },
      {
        "shortcode": "vampire_man",
        "glyph": "🧛‍♂️",
        "keywords": [
          "blood",
          "fangs",
          "halloween",
          "man",
          "scary",
          "supernatural",
          "teeth",
          "undead",
          "vampire"
        ],
        "aliases": [
          "man_vampire"
        ]
      },
      {
        "shortcode": "vampire_woman",
        "glyph": "🧛‍♀️",
        "keywords": [
          "blood",
          "fangs",
          "halloween",
          "scary",
          "supernatural",
          "teeth",
          "undead",
          "vampire",
          "woman"
        ],
        "aliases": [
          "woman_vampire"
        ]
      },
      {
        "shortcode": "merperson",
        "glyph": "🧜",
        "keywords": [
          "creature",
          "fairytale",
          "folklore",
          "ocean",
          "sea",
          "siren",
          "trident"
        ]
      },
      {
        "shortcode": "merman",
        "glyph": "🧜‍♂️",
        "keywords": [
          "creature",
          "fairytale",
          "folklore",
          "neptune",
          "ocean",
          "poseidon",
          "sea",
          "siren",
          "trident",
          "triton"
        ]
      },
      {
        "shortcode": "mermaid",
        "glyph": "🧜‍♀️",
        "keywords": [
          "creature",
          "fairytale",
          "folklore",
          "merwoman",
          "ocean",
          "sea",
          "siren",
          "trident"
        ]
      },
      {
        "shortcode": "elf",
        "glyph": "🧝",
        "keywords": [
          "elves",
          "enchantment",
          "fantasy",
          "folklore",
          "magic",
          "magical",
          "myth"
        ]
      },
      {
        "shortcode": "elf_man",
        "glyph": "🧝‍♂️",
        "keywords": [
          "elf",
          "elves",
          "enchantment",
          "fantasy",
          "folklore",
          "magic",
          "magical",
          "man",
          "myth"
        ],
        "aliases": [
          "man_elf"
        ]
      },
      {
        "shortcode": "elf_woman",
        "glyph": "🧝‍♀️",
        "keywords": [
          "elf",
          "elves",
          "enchantment",
          "fantasy",
          "folklore",
          "magic",
          "magical",
          "myth",
          "woman"
        ],
        "aliases": [
          "woman_elf"
        ]
      },
      {
        "shortcode": "genie",
        "glyph": "🧞",
        "keywords": [
          "djinn",
          "fantasy",
          "jinn",
          "lamp",
          "myth",
          "rub",
          "wishes"
        ]
      },
      {
        "shortcode": "genie_man",
        "glyph": "🧞‍♂️",
        "keywords": [
          "djinn",
          "fantasy",
          "genie",
          "jinn",
          "lamp",
          "man",
          "myth",
          "rub",
          "wishes"
        ],
        "aliases": [
          "man_genie"
        ]
      },
      {
        "shortcode": "genie_woman",
        "glyph": "🧞‍♀️",
        "keywords": [
          "djinn",
          "fantasy",
          "genie",
          "jinn",
          "lamp",
          "myth",
          "rub",
          "wishes",
          "woman"
        ],
        "aliases": [
          "woman_genie"
        ]
      },
      {
        "shortcode": "zombie",
        "glyph": "🧟",
        "keywords": [
          "apocalypse",
          "dead",
          "halloween",
          "horror",
          "scary",
          "undead",
          "walking"
        ]
      },
      {
        "shortcode": "zombie_man",
        "glyph": "🧟‍♂️",
        "keywords": [
          "apocalypse",
          "dead",
          "halloween",
          "horror",
          "man",
          "scary",
          "undead",
          "walking",
          "zombie"
        ],
        "aliases": [
          "man_zombie"
        ]
      },
      {
        "shortcode": "zombie_woman",
        "glyph": "🧟‍♀️",
        "keywords": [
          "apocalypse",
          "dead",
          "halloween",
          "horror",
          "scary",
          "undead",
          "walking",
          "woman",
          "zombie"
        ],
        "aliases": [
          "woman_zombie"
        ]
      },
      {
        "shortcode": "troll",
        "glyph": "🧌",
        "keywords": [
          "fairy",
          "fantasy",
          "monster",
          "tale",
          "trolling"
        ]
      },
      {
        "shortcode": "hairy_creature",
        "glyph": "🫈",
        "keywords": [
          "bigfoot",
          "cryptid",
          "forest",
          "giant",
          "hairy",
          "sasquatch",
          "woodwose",
          "yeti"
        ]
      },
      {
        "shortcode": "massage",
        "glyph": "💆",
        "keywords": [
          "face",
          "getting",
          "headache",
          "massage",
          "person",
          "relax",
          "relaxing",
          "salon",
          "soothe",
          "spa",
          "tension",
          "therapy",
          "treatment"
        ],
        "aliases": [
          "person_getting_massage"
        ]
      },
      {
        "shortcode": "massage_man",
        "glyph": "💆‍♂️",
        "keywords": [
          "face",
          "getting",
          "headache",
          "man",
          "massage",
          "relax",
          "relaxing",
          "salon",
          "soothe",
          "spa",
          "tension",
          "therapy",
          "treatment"
        ],
        "aliases": [
          "man_getting_massage"
        ]
      },
      {
        "shortcode": "massage_woman",
        "glyph": "💆‍♀️",
        "keywords": [
          "face",
          "getting",
          "headache",
          "massage",
          "relax",
          "relaxing",
          "salon",
          "soothe",
          "spa",
          "tension",
          "therapy",
          "treatment",
          "woman"
        ],
        "aliases": [
          "woman_getting_massage"
        ]
      },
      {
        "shortcode": "haircut",
        "glyph": "💇",
        "keywords": [
          "barber",
          "beauty",
          "chop",
          "cosmetology",
          "cut",
          "groom",
          "hair",
          "haircut",
          "parlor",
          "person",
          "shears",
          "style"
        ],
        "aliases": [
          "person_getting_haircut"
        ]
      },
      {
        "shortcode": "haircut_man",
        "glyph": "💇‍♂️",
        "keywords": [
          "barber",
          "beauty",
          "chop",
          "cosmetology",
          "cut",
          "groom",
          "hair",
          "haircut",
          "man",
          "parlor",
          "person",
          "shears",
          "style"
        ],
        "aliases": [
          "man_getting_haircut"
        ]
      },
      {
        "shortcode": "haircut_woman",
        "glyph": "💇‍♀️",
        "keywords": [
          "barber",
          "beauty",
          "chop",
          "cosmetology",
          "cut",
          "groom",
          "hair",
          "haircut",
          "parlor",
          "person",
          "shears",
          "style",
          "woman"
        ],
        "aliases": [
          "woman_getting_haircut"
        ]
      },
      {
        "shortcode": "walking",
        "glyph": "🚶",
        "keywords": [
          "amble",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "person",
          "stride",
          "stroll",
          "walk",
          "walking"
        ],
        "aliases": [
          "person_walking"
        ]
      },
      {
        "shortcode": "walking_man",
        "glyph": "🚶‍♂️",
        "keywords": [
          "amble",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "stride",
          "stroll",
          "walk",
          "walking"
        ],
        "aliases": [
          "man_walking"
        ]
      },
      {
        "shortcode": "walking_woman",
        "glyph": "🚶‍♀️",
        "keywords": [
          "amble",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "stride",
          "stroll",
          "walk",
          "walking",
          "woman"
        ],
        "aliases": [
          "woman_walking"
        ]
      },
      {
        "shortcode": "person_walking_right",
        "glyph": "🚶‍➡️",
        "keywords": [
          "amble",
          "facing",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "person",
          "right",
          "stride",
          "stroll",
          "walk",
          "walking"
        ]
      },
      {
        "shortcode": "woman_walking_right",
        "glyph": "🚶‍♀️‍➡️",
        "keywords": [
          "amble",
          "facing",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "right",
          "stride",
          "stroll",
          "walk",
          "walking",
          "woman"
        ]
      },
      {
        "shortcode": "man_walking_right",
        "glyph": "🚶‍♂️‍➡️",
        "keywords": [
          "amble",
          "facing",
          "gait",
          "hike",
          "man",
          "pace",
          "pedestrian",
          "right",
          "stride",
          "stroll",
          "walk",
          "walking"
        ]
      },
      {
        "shortcode": "standing_person",
        "glyph": "🧍",
        "keywords": [
          "person",
          "stand",
          "standing"
        ],
        "aliases": [
          "person_standing",
          "standing"
        ]
      },
      {
        "shortcode": "standing_man",
        "glyph": "🧍‍♂️",
        "keywords": [
          "man",
          "stand",
          "standing"
        ],
        "aliases": [
          "man_standing"
        ]
      },
      {
        "shortcode": "standing_woman",
        "glyph": "🧍‍♀️",
        "keywords": [
          "stand",
          "standing",
          "woman"
        ],
        "aliases": [
          "woman_standing"
        ]
      },
      {
        "shortcode": "kneeling_person",
        "glyph": "🧎",
        "keywords": [
          "kneel",
          "kneeling",
          "knees",
          "person"
        ],
        "aliases": [
          "kneeling",
          "person_kneeling"
        ]
      },
      {
        "shortcode": "kneeling_man",
        "glyph": "🧎‍♂️",
        "keywords": [
          "kneel",
          "kneeling",
          "knees",
          "man"
        ],
        "aliases": [
          "man_kneeling"
        ]
      },
      {
        "shortcode": "kneeling_woman",
        "glyph": "🧎‍♀️",
        "keywords": [
          "kneel",
          "kneeling",
          "knees",
          "woman"
        ],
        "aliases": [
          "woman_kneeling"
        ]
      },
      {
        "shortcode": "person_kneeling_right",
        "glyph": "🧎‍➡️",
        "keywords": [
          "facing",
          "kneel",
          "kneeling",
          "knees",
          "person",
          "right"
        ]
      },
      {
        "shortcode": "woman_kneeling_right",
        "glyph": "🧎‍♀️‍➡️",
        "keywords": [
          "facing",
          "kneel",
          "kneeling",
          "knees",
          "right",
          "woman"
        ]
      },
      {
        "shortcode": "man_kneeling_right",
        "glyph": "🧎‍♂️‍➡️",
        "keywords": [
          "facing",
          "kneel",
          "kneeling",
          "knees",
          "man",
          "right"
        ]
      },
      {
        "shortcode": "person_with_probing_cane",
        "glyph": "🧑‍🦯",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "person",
          "probing",
          "white"
        ],
        "aliases": [
          "person_with_white_cane"
        ]
      },
      {
        "shortcode": "person_with_white_cane_right",
        "glyph": "🧑‍🦯‍➡️",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "facing",
          "person",
          "probing",
          "right",
          "white"
        ]
      },
      {
        "shortcode": "man_with_probing_cane",
        "glyph": "👨‍🦯",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "man",
          "probing",
          "white"
        ],
        "aliases": [
          "man_with_white_cane"
        ]
      },
      {
        "shortcode": "man_with_white_cane_right",
        "glyph": "👨‍🦯‍➡️",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "facing",
          "man",
          "probing",
          "right",
          "white"
        ]
      },
      {
        "shortcode": "woman_with_probing_cane",
        "glyph": "👩‍🦯",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "probing",
          "white",
          "woman"
        ],
        "aliases": [
          "woman_with_white_cane"
        ]
      },
      {
        "shortcode": "woman_with_white_cane_right",
        "glyph": "👩‍🦯‍➡️",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "facing",
          "probing",
          "right",
          "white",
          "woman"
        ]
      },
      {
        "shortcode": "person_in_motorized_wheelchair",
        "glyph": "🧑‍🦼",
        "keywords": [
          "accessibility",
          "motorized",
          "person",
          "wheelchair"
        ]
      },
      {
        "shortcode": "person_in_motorized_wheelchair_right",
        "glyph": "🧑‍🦼‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "motorized",
          "person",
          "right",
          "wheelchair"
        ]
      },
      {
        "shortcode": "man_in_motorized_wheelchair",
        "glyph": "👨‍🦼",
        "keywords": [
          "accessibility",
          "man",
          "motorized",
          "wheelchair"
        ]
      },
      {
        "shortcode": "man_in_motorized_wheelchair_right",
        "glyph": "👨‍🦼‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "man",
          "motorized",
          "right",
          "wheelchair"
        ]
      },
      {
        "shortcode": "woman_in_motorized_wheelchair",
        "glyph": "👩‍🦼",
        "keywords": [
          "accessibility",
          "motorized",
          "wheelchair",
          "woman"
        ]
      },
      {
        "shortcode": "woman_in_motorized_wheelchair_right",
        "glyph": "👩‍🦼‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "motorized",
          "right",
          "wheelchair",
          "woman"
        ]
      },
      {
        "shortcode": "person_in_manual_wheelchair",
        "glyph": "🧑‍🦽",
        "keywords": [
          "accessibility",
          "manual",
          "person",
          "wheelchair"
        ]
      },
      {
        "shortcode": "person_in_manual_wheelchair_right",
        "glyph": "🧑‍🦽‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "manual",
          "person",
          "right",
          "wheelchair"
        ]
      },
      {
        "shortcode": "man_in_manual_wheelchair",
        "glyph": "👨‍🦽",
        "keywords": [
          "accessibility",
          "man",
          "manual",
          "wheelchair"
        ]
      },
      {
        "shortcode": "man_in_manual_wheelchair_right",
        "glyph": "👨‍🦽‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "man",
          "manual",
          "right",
          "wheelchair"
        ]
      },
      {
        "shortcode": "woman_in_manual_wheelchair",
        "glyph": "👩‍🦽",
        "keywords": [
          "accessibility",
          "manual",
          "wheelchair",
          "woman"
        ]
      },
      {
        "shortcode": "woman_in_manual_wheelchair_right",
        "glyph": "👩‍🦽‍➡️",
        "keywords": [
          "accessibility",
          "facing",
          "manual",
          "right",
          "wheelchair",
          "woman"
        ]
      },
      {
        "shortcode": "runner",
        "glyph": "🏃",
        "keywords": [
          "fast",
          "hurry",
          "marathon",
          "move",
          "person",
          "quick",
          "race",
          "racing",
          "run",
          "rush",
          "speed"
        ],
        "aliases": [
          "running",
          "person_running"
        ]
      },
      {
        "shortcode": "running_man",
        "glyph": "🏃‍♂️",
        "keywords": [
          "fast",
          "hurry",
          "man",
          "marathon",
          "move",
          "quick",
          "race",
          "racing",
          "run",
          "rush",
          "speed"
        ],
        "aliases": [
          "man_running"
        ]
      },
      {
        "shortcode": "running_woman",
        "glyph": "🏃‍♀️",
        "keywords": [
          "fast",
          "hurry",
          "marathon",
          "move",
          "quick",
          "race",
          "racing",
          "run",
          "rush",
          "speed",
          "woman"
        ],
        "aliases": [
          "woman_running"
        ]
      },
      {
        "shortcode": "person_running_right",
        "glyph": "🏃‍➡️",
        "keywords": [
          "facing",
          "fast",
          "hurry",
          "marathon",
          "move",
          "person",
          "quick",
          "race",
          "racing",
          "right",
          "run",
          "rush",
          "speed"
        ]
      },
      {
        "shortcode": "woman_running_right",
        "glyph": "🏃‍♀️‍➡️",
        "keywords": [
          "facing",
          "fast",
          "hurry",
          "marathon",
          "move",
          "quick",
          "race",
          "racing",
          "right",
          "run",
          "rush",
          "speed",
          "woman"
        ]
      },
      {
        "shortcode": "man_running_right",
        "glyph": "🏃‍♂️‍➡️",
        "keywords": [
          "facing",
          "fast",
          "hurry",
          "man",
          "marathon",
          "move",
          "quick",
          "race",
          "racing",
          "right",
          "run",
          "rush",
          "speed"
        ]
      },
      {
        "shortcode": "ballet_dancer",
        "glyph": "🧑‍🩰",
        "keywords": [
          "ballet",
          "dancer"
        ]
      },
      {
        "shortcode": "dancer",
        "glyph": "💃",
        "keywords": [
          "dance",
          "dancer",
          "dancing",
          "elegant",
          "festive",
          "flair",
          "flamenco",
          "groove",
          "let’s",
          "salsa",
          "tango",
          "woman"
        ],
        "aliases": [
          "woman_dancing"
        ]
      },
      {
        "shortcode": "man_dancing",
        "glyph": "🕺",
        "keywords": [
          "dance",
          "dancer",
          "dancing",
          "elegant",
          "festive",
          "flair",
          "flamenco",
          "groove",
          "let’s",
          "man",
          "salsa",
          "tango"
        ]
      },
      {
        "shortcode": "business_suit_levitating",
        "glyph": "🕴️",
        "keywords": [
          "business",
          "levitating",
          "person",
          "suit"
        ],
        "aliases": [
          "levitate",
          "levitating",
          "person_in_suit_levitating"
        ]
      },
      {
        "shortcode": "dancers",
        "glyph": "👯",
        "keywords": [
          "bestie",
          "bff",
          "bunny",
          "counterpart",
          "dancer",
          "double",
          "ear",
          "identical",
          "pair",
          "party",
          "partying",
          "people",
          "soulmate",
          "twin",
          "twinsies"
        ],
        "aliases": [
          "people_with_bunny_ears_partying"
        ]
      },
      {
        "shortcode": "dancing_men",
        "glyph": "👯‍♂️",
        "keywords": [
          "bestie",
          "bff",
          "bunny",
          "counterpart",
          "dancer",
          "double",
          "ear",
          "identical",
          "men",
          "pair",
          "party",
          "partying",
          "people",
          "soulmate",
          "twin",
          "twinsies"
        ],
        "aliases": [
          "men_with_bunny_ears_partying"
        ]
      },
      {
        "shortcode": "dancing_women",
        "glyph": "👯‍♀️",
        "keywords": [
          "bestie",
          "bff",
          "bunny",
          "counterpart",
          "dancer",
          "double",
          "ear",
          "identical",
          "pair",
          "party",
          "partying",
          "people",
          "soulmate",
          "twin",
          "twinsies",
          "women"
        ],
        "aliases": [
          "women_with_bunny_ears_partying"
        ]
      },
      {
        "shortcode": "sauna_person",
        "glyph": "🧖",
        "keywords": [
          "day",
          "luxurious",
          "pamper",
          "person",
          "relax",
          "room",
          "sauna",
          "spa",
          "steam",
          "steambath",
          "unwind"
        ],
        "aliases": [
          "person_in_steamy_room"
        ]
      },
      {
        "shortcode": "sauna_man",
        "glyph": "🧖‍♂️",
        "keywords": [
          "day",
          "luxurious",
          "man",
          "pamper",
          "relax",
          "room",
          "sauna",
          "spa",
          "steam",
          "steambath",
          "unwind"
        ],
        "aliases": [
          "man_in_steamy_room"
        ]
      },
      {
        "shortcode": "sauna_woman",
        "glyph": "🧖‍♀️",
        "keywords": [
          "day",
          "luxurious",
          "pamper",
          "relax",
          "room",
          "sauna",
          "spa",
          "steam",
          "steambath",
          "unwind",
          "woman"
        ],
        "aliases": [
          "woman_in_steamy_room"
        ]
      },
      {
        "shortcode": "climbing",
        "glyph": "🧗",
        "keywords": [
          "climb",
          "climber",
          "climbing",
          "mountain",
          "person",
          "rock",
          "scale",
          "up"
        ],
        "aliases": [
          "person_climbing"
        ]
      },
      {
        "shortcode": "climbing_man",
        "glyph": "🧗‍♂️",
        "keywords": [
          "climb",
          "climber",
          "climbing",
          "man",
          "mountain",
          "rock",
          "scale",
          "up"
        ],
        "aliases": [
          "man_climbing"
        ]
      },
      {
        "shortcode": "climbing_woman",
        "glyph": "🧗‍♀️",
        "keywords": [
          "climb",
          "climber",
          "climbing",
          "mountain",
          "rock",
          "scale",
          "up",
          "woman"
        ],
        "aliases": [
          "woman_climbing"
        ]
      },
      {
        "shortcode": "person_fencing",
        "glyph": "🤺",
        "keywords": [
          "fencer",
          "fencing",
          "person",
          "sword"
        ],
        "aliases": [
          "fencer",
          "fencing"
        ]
      },
      {
        "shortcode": "horse_racing",
        "glyph": "🏇",
        "keywords": [
          "horse",
          "jockey",
          "racehorse",
          "racing",
          "riding",
          "sport"
        ]
      },
      {
        "shortcode": "skier",
        "glyph": "⛷️",
        "keywords": [
          "ski",
          "snow"
        ],
        "aliases": [
          "person_skiing",
          "skiing"
        ]
      },
      {
        "shortcode": "snowboarder",
        "glyph": "🏂️",
        "keywords": [
          "ski",
          "snow",
          "snowboard",
          "sport"
        ],
        "aliases": [
          "person_snowboarding",
          "snowboarding"
        ]
      },
      {
        "shortcode": "golfing",
        "glyph": "🏌️",
        "keywords": [
          "ball",
          "birdie",
          "caddy",
          "driving",
          "golf",
          "golfing",
          "green",
          "person",
          "pga",
          "putt",
          "range",
          "tee"
        ],
        "aliases": [
          "golfer",
          "person_golfing"
        ]
      },
      {
        "shortcode": "golfing_man",
        "glyph": "🏌️‍♂️",
        "keywords": [
          "ball",
          "birdie",
          "caddy",
          "driving",
          "golf",
          "golfing",
          "green",
          "man",
          "pga",
          "putt",
          "range",
          "tee"
        ],
        "aliases": [
          "man_golfing"
        ]
      },
      {
        "shortcode": "golfing_woman",
        "glyph": "🏌️‍♀️",
        "keywords": [
          "ball",
          "birdie",
          "caddy",
          "driving",
          "golf",
          "golfing",
          "green",
          "pga",
          "putt",
          "range",
          "tee",
          "woman"
        ],
        "aliases": [
          "woman_golfing"
        ]
      },
      {
        "shortcode": "surfer",
        "glyph": "🏄️",
        "keywords": [
          "beach",
          "ocean",
          "person",
          "sport",
          "surf",
          "surfer",
          "surfing",
          "swell",
          "waves"
        ],
        "aliases": [
          "person_surfing",
          "surfing"
        ]
      },
      {
        "shortcode": "surfing_man",
        "glyph": "🏄‍♂️",
        "keywords": [
          "beach",
          "man",
          "ocean",
          "sport",
          "surf",
          "surfer",
          "surfing",
          "swell",
          "waves"
        ],
        "aliases": [
          "man_surfing"
        ]
      },
      {
        "shortcode": "surfing_woman",
        "glyph": "🏄‍♀️",
        "keywords": [
          "beach",
          "ocean",
          "person",
          "sport",
          "surf",
          "surfer",
          "surfing",
          "swell",
          "waves"
        ],
        "aliases": [
          "woman_surfing"
        ]
      },
      {
        "shortcode": "rowboat",
        "glyph": "🚣",
        "keywords": [
          "boat",
          "canoe",
          "cruise",
          "fishing",
          "lake",
          "oar",
          "paddle",
          "person",
          "raft",
          "river",
          "row",
          "rowboat",
          "rowing"
        ],
        "aliases": [
          "person_rowing_boat"
        ]
      },
      {
        "shortcode": "rowing_man",
        "glyph": "🚣‍♂️",
        "keywords": [
          "boat",
          "canoe",
          "cruise",
          "fishing",
          "lake",
          "man",
          "oar",
          "paddle",
          "raft",
          "river",
          "row",
          "rowboat",
          "rowing"
        ],
        "aliases": [
          "man_rowing_boat"
        ]
      },
      {
        "shortcode": "rowing_woman",
        "glyph": "🚣‍♀️",
        "keywords": [
          "boat",
          "canoe",
          "cruise",
          "fishing",
          "lake",
          "oar",
          "paddle",
          "raft",
          "river",
          "row",
          "rowboat",
          "rowing",
          "woman"
        ],
        "aliases": [
          "woman_rowing_boat"
        ]
      },
      {
        "shortcode": "swimmer",
        "glyph": "🏊️",
        "keywords": [
          "freestyle",
          "person",
          "sport",
          "swim",
          "swimmer",
          "swimming",
          "triathlon"
        ],
        "aliases": [
          "person_swimming",
          "swimming"
        ]
      },
      {
        "shortcode": "swimming_man",
        "glyph": "🏊‍♂️",
        "keywords": [
          "freestyle",
          "man",
          "sport",
          "swim",
          "swimmer",
          "swimming",
          "triathlon"
        ],
        "aliases": [
          "man_swimming"
        ]
      },
      {
        "shortcode": "swimming_woman",
        "glyph": "🏊‍♀️",
        "keywords": [
          "freestyle",
          "man",
          "sport",
          "swim",
          "swimmer",
          "swimming",
          "triathlon"
        ],
        "aliases": [
          "woman_swimming"
        ]
      },
      {
        "shortcode": "bouncing_ball_person",
        "glyph": "⛹️",
        "keywords": [
          "athletic",
          "ball",
          "basketball",
          "bouncing",
          "championship",
          "dribble",
          "net",
          "person",
          "player",
          "throw"
        ],
        "aliases": [
          "person_bouncing_ball"
        ]
      },
      {
        "shortcode": "basketball_man",
        "glyph": "⛹️‍♂️",
        "keywords": [
          "athletic",
          "ball",
          "basketball",
          "bouncing",
          "championship",
          "dribble",
          "man",
          "net",
          "player",
          "throw"
        ],
        "aliases": [
          "bouncing_ball_man",
          "man_bouncing_ball"
        ]
      },
      {
        "shortcode": "basketball_woman",
        "glyph": "⛹️‍♀️",
        "keywords": [
          "athletic",
          "ball",
          "basketball",
          "bouncing",
          "championship",
          "dribble",
          "net",
          "player",
          "throw",
          "woman"
        ],
        "aliases": [
          "bouncing_ball_woman",
          "woman_bouncing_ball"
        ]
      },
      {
        "shortcode": "weight_lifting",
        "glyph": "🏋️",
        "keywords": [
          "barbell",
          "bodybuilder",
          "deadlift",
          "lifter",
          "lifting",
          "person",
          "powerlifting",
          "weight",
          "weightlifter",
          "weights",
          "workout"
        ],
        "aliases": [
          "person_lifting_weights",
          "weight_lifter"
        ]
      },
      {
        "shortcode": "weight_lifting_man",
        "glyph": "🏋️‍♂️",
        "keywords": [
          "barbell",
          "bodybuilder",
          "deadlift",
          "lifter",
          "lifting",
          "man",
          "powerlifting",
          "weight",
          "weightlifter",
          "weights",
          "workout"
        ],
        "aliases": [
          "man_lifting_weights"
        ]
      },
      {
        "shortcode": "weight_lifting_woman",
        "glyph": "🏋️‍♀️",
        "keywords": [
          "barbell",
          "bodybuilder",
          "deadlift",
          "lifter",
          "lifting",
          "powerlifting",
          "weight",
          "weightlifter",
          "weights",
          "woman",
          "workout"
        ],
        "aliases": [
          "woman_lifting_weights"
        ]
      },
      {
        "shortcode": "bicyclist",
        "glyph": "🚴",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "person",
          "riding",
          "sport"
        ],
        "aliases": [
          "biking",
          "person_biking"
        ]
      },
      {
        "shortcode": "biking_man",
        "glyph": "🚴‍♂️",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "man",
          "riding",
          "sport"
        ],
        "aliases": [
          "man_biking"
        ]
      },
      {
        "shortcode": "biking_woman",
        "glyph": "🚴‍♀️",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "riding",
          "sport",
          "woman"
        ],
        "aliases": [
          "woman_biking"
        ]
      },
      {
        "shortcode": "mountain_bicyclist",
        "glyph": "🚵",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "mountain",
          "person",
          "riding",
          "sport"
        ],
        "aliases": [
          "mountain_biking",
          "person_mountain_biking"
        ]
      },
      {
        "shortcode": "mountain_biking_man",
        "glyph": "🚵‍♂️",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "man",
          "mountain",
          "riding",
          "sport"
        ],
        "aliases": [
          "man_mountain_biking"
        ]
      },
      {
        "shortcode": "mountain_biking_woman",
        "glyph": "🚵‍♀️",
        "keywords": [
          "bicycle",
          "bicyclist",
          "bike",
          "biking",
          "cycle",
          "cyclist",
          "mountain",
          "riding",
          "sport",
          "woman"
        ],
        "aliases": [
          "woman_mountain_biking"
        ]
      },
      {
        "shortcode": "cartwheeling",
        "glyph": "🤸",
        "keywords": [
          "active",
          "cartwheel",
          "cartwheeling",
          "excited",
          "flip",
          "gymnastics",
          "happy",
          "person",
          "somersault"
        ],
        "aliases": [
          "person_cartwheel"
        ]
      },
      {
        "shortcode": "man_cartwheeling",
        "glyph": "🤸‍♂️",
        "keywords": [
          "active",
          "cartwheel",
          "cartwheeling",
          "excited",
          "flip",
          "gymnastics",
          "happy",
          "man",
          "somersault"
        ]
      },
      {
        "shortcode": "woman_cartwheeling",
        "glyph": "🤸‍♀️",
        "keywords": [
          "active",
          "cartwheel",
          "cartwheeling",
          "excited",
          "flip",
          "gymnastics",
          "happy",
          "somersault",
          "woman"
        ]
      },
      {
        "shortcode": "wrestling",
        "glyph": "🤼",
        "keywords": [
          "combat",
          "duel",
          "grapple",
          "people",
          "ring",
          "tournament",
          "wrestle",
          "wrestling"
        ],
        "aliases": [
          "people_wrestling",
          "wrestlers"
        ]
      },
      {
        "shortcode": "men_wrestling",
        "glyph": "🤼‍♂️",
        "keywords": [
          "combat",
          "duel",
          "grapple",
          "men",
          "ring",
          "tournament",
          "wrestle",
          "wrestling"
        ]
      },
      {
        "shortcode": "women_wrestling",
        "glyph": "🤼‍♀️",
        "keywords": [
          "combat",
          "duel",
          "grapple",
          "ring",
          "tournament",
          "women",
          "wrestle",
          "wrestling"
        ]
      },
      {
        "shortcode": "water_polo",
        "glyph": "🤽",
        "keywords": [
          "person",
          "playing",
          "polo",
          "sport",
          "swimming",
          "water",
          "waterpolo"
        ],
        "aliases": [
          "person_playing_water_polo"
        ]
      },
      {
        "shortcode": "man_playing_water_polo",
        "glyph": "🤽‍♂️",
        "keywords": [
          "man",
          "playing",
          "polo",
          "sport",
          "swimming",
          "water",
          "waterpolo"
        ]
      },
      {
        "shortcode": "woman_playing_water_polo",
        "glyph": "🤽‍♀️",
        "keywords": [
          "playing",
          "polo",
          "sport",
          "swimming",
          "water",
          "waterpolo",
          "woman"
        ]
      },
      {
        "shortcode": "handball_person",
        "glyph": "🤾",
        "keywords": [
          "athletics",
          "ball",
          "catch",
          "chuck",
          "handball",
          "hurl",
          "lob",
          "person",
          "pitch",
          "playing",
          "sport",
          "throw",
          "toss"
        ],
        "aliases": [
          "handball",
          "person_playing_handball"
        ]
      },
      {
        "shortcode": "man_playing_handball",
        "glyph": "🤾‍♂️",
        "keywords": [
          "athletics",
          "ball",
          "catch",
          "chuck",
          "handball",
          "hurl",
          "lob",
          "man",
          "pitch",
          "playing",
          "sport",
          "throw",
          "toss"
        ]
      },
      {
        "shortcode": "woman_playing_handball",
        "glyph": "🤾‍♀️",
        "keywords": [
          "athletics",
          "ball",
          "catch",
          "chuck",
          "handball",
          "hurl",
          "lob",
          "pitch",
          "playing",
          "sport",
          "throw",
          "toss",
          "woman"
        ]
      },
      {
        "shortcode": "juggling_person",
        "glyph": "🤹",
        "keywords": [
          "act",
          "balance",
          "balancing",
          "handle",
          "juggle",
          "juggling",
          "manage",
          "multitask",
          "person",
          "skill"
        ],
        "aliases": [
          "juggler",
          "juggling",
          "person_juggling"
        ]
      },
      {
        "shortcode": "man_juggling",
        "glyph": "🤹‍♂️",
        "keywords": [
          "act",
          "balance",
          "balancing",
          "handle",
          "juggle",
          "juggling",
          "man",
          "manage",
          "multitask",
          "skill"
        ]
      },
      {
        "shortcode": "woman_juggling",
        "glyph": "🤹‍♀️",
        "keywords": [
          "act",
          "balance",
          "balancing",
          "handle",
          "juggle",
          "juggling",
          "manage",
          "multitask",
          "skill",
          "woman"
        ]
      },
      {
        "shortcode": "lotus_position",
        "glyph": "🧘",
        "keywords": [
          "cross",
          "legged",
          "legs",
          "lotus",
          "meditation",
          "peace",
          "person",
          "position",
          "relax",
          "serenity",
          "yoga",
          "yogi",
          "zen"
        ],
        "aliases": [
          "person_in_lotus_position"
        ]
      },
      {
        "shortcode": "lotus_position_man",
        "glyph": "🧘‍♂️",
        "keywords": [
          "cross",
          "legged",
          "legs",
          "lotus",
          "man",
          "meditation",
          "peace",
          "position",
          "relax",
          "serenity",
          "yoga",
          "yogi",
          "zen"
        ],
        "aliases": [
          "man_in_lotus_position"
        ]
      },
      {
        "shortcode": "lotus_position_woman",
        "glyph": "🧘‍♀️",
        "keywords": [
          "cross",
          "legged",
          "legs",
          "lotus",
          "meditation",
          "peace",
          "position",
          "relax",
          "serenity",
          "woman",
          "yoga",
          "yogi",
          "zen"
        ],
        "aliases": [
          "woman_in_lotus_position"
        ]
      },
      {
        "shortcode": "bath",
        "glyph": "🛀",
        "keywords": [
          "bath",
          "bathtub",
          "person",
          "taking",
          "tub"
        ],
        "aliases": [
          "person_taking_bath"
        ]
      },
      {
        "shortcode": "sleeping_bed",
        "glyph": "🛌",
        "keywords": [
          "bed",
          "bedtime",
          "good",
          "goodnight",
          "hotel",
          "nap",
          "night",
          "person",
          "sleep",
          "tired",
          "zzz"
        ],
        "aliases": [
          "person_in_bed",
          "sleeping_accommodation"
        ]
      },
      {
        "shortcode": "people_holding_hands",
        "glyph": "🧑‍🤝‍🧑",
        "keywords": [
          "bae",
          "bestie",
          "bff",
          "couple",
          "dating",
          "flirt",
          "friends",
          "hand",
          "hold",
          "people",
          "twins"
        ]
      },
      {
        "shortcode": "two_women_holding_hands",
        "glyph": "👭",
        "keywords": [
          "bae",
          "bestie",
          "bff",
          "couple",
          "dating",
          "flirt",
          "friends",
          "girls",
          "hand",
          "hold",
          "sisters",
          "twins",
          "women"
        ]
      },
      {
        "shortcode": "couple",
        "glyph": "👫",
        "keywords": [
          "bae",
          "bestie",
          "bff",
          "couple",
          "dating",
          "flirt",
          "friends",
          "hand",
          "hold",
          "man",
          "twins",
          "woman"
        ]
      },
      {
        "shortcode": "two_men_holding_hands",
        "glyph": "👬",
        "keywords": [
          "bae",
          "bestie",
          "bff",
          "boys",
          "brothers",
          "couple",
          "dating",
          "flirt",
          "friends",
          "hand",
          "hold",
          "men",
          "twins"
        ]
      },
      {
        "shortcode": "couplekiss",
        "glyph": "💏",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "date",
          "dating",
          "heart",
          "love",
          "mwah",
          "person",
          "romance",
          "together",
          "xoxo"
        ],
        "aliases": [
          "couple_kiss"
        ]
      },
      {
        "shortcode": "couplekiss_man_woman",
        "glyph": "👩‍❤️‍💋‍👨",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "date",
          "dating",
          "heart",
          "kiss",
          "love",
          "man",
          "mwah",
          "person",
          "romance",
          "together",
          "woman",
          "xoxo"
        ],
        "aliases": [
          "kiss_mw",
          "kiss_wm"
        ]
      },
      {
        "shortcode": "couplekiss_man_man",
        "glyph": "👨‍❤️‍💋‍👨",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "date",
          "dating",
          "heart",
          "kiss",
          "love",
          "man",
          "mwah",
          "person",
          "romance",
          "together",
          "xoxo"
        ],
        "aliases": [
          "kiss_mm"
        ]
      },
      {
        "shortcode": "couplekiss_woman_woman",
        "glyph": "👩‍❤️‍💋‍👩",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "date",
          "dating",
          "heart",
          "kiss",
          "love",
          "mwah",
          "person",
          "romance",
          "together",
          "woman",
          "xoxo"
        ],
        "aliases": [
          "kiss_ww"
        ]
      },
      {
        "shortcode": "couple_with_heart",
        "glyph": "💑",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "dating",
          "heart",
          "kiss",
          "love",
          "person",
          "relationship",
          "romance",
          "together",
          "you"
        ]
      },
      {
        "shortcode": "couple_with_heart_woman_man",
        "glyph": "👩‍❤️‍👨",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "dating",
          "heart",
          "kiss",
          "love",
          "man",
          "person",
          "relationship",
          "romance",
          "together",
          "woman",
          "you"
        ],
        "aliases": [
          "couple_with_heart_mw",
          "couple_with_heart_wm"
        ]
      },
      {
        "shortcode": "couple_with_heart_man_man",
        "glyph": "👨‍❤️‍👨",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "dating",
          "heart",
          "kiss",
          "love",
          "man",
          "person",
          "relationship",
          "romance",
          "together",
          "you"
        ],
        "aliases": [
          "couple_with_heart_mm"
        ]
      },
      {
        "shortcode": "couple_with_heart_woman_woman",
        "glyph": "👩‍❤️‍👩",
        "keywords": [
          "anniversary",
          "babe",
          "bae",
          "couple",
          "dating",
          "heart",
          "kiss",
          "love",
          "person",
          "relationship",
          "romance",
          "together",
          "woman",
          "you"
        ],
        "aliases": [
          "couple_with_heart_ww"
        ]
      },
      {
        "shortcode": "family_man_woman_boy",
        "glyph": "👨‍👩‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man",
          "woman"
        ],
        "aliases": [
          "family_mwb"
        ]
      },
      {
        "shortcode": "family_man_woman_girl",
        "glyph": "👨‍👩‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man",
          "woman"
        ],
        "aliases": [
          "family_mwg"
        ]
      },
      {
        "shortcode": "family_man_woman_girl_boy",
        "glyph": "👨‍👩‍👧‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "girl",
          "man",
          "woman"
        ],
        "aliases": [
          "family_mwgb"
        ]
      },
      {
        "shortcode": "family_man_woman_boy_boy",
        "glyph": "👨‍👩‍👦‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man",
          "woman"
        ],
        "aliases": [
          "family_mwbb"
        ]
      },
      {
        "shortcode": "family_man_woman_girl_girl",
        "glyph": "👨‍👩‍👧‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man",
          "woman"
        ],
        "aliases": [
          "family_mwgg"
        ]
      },
      {
        "shortcode": "family_man_man_boy",
        "glyph": "👨‍👨‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man"
        ],
        "aliases": [
          "family_mmb"
        ]
      },
      {
        "shortcode": "family_man_man_girl",
        "glyph": "👨‍👨‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mmg"
        ]
      },
      {
        "shortcode": "family_man_man_girl_boy",
        "glyph": "👨‍👨‍👧‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mmgb"
        ]
      },
      {
        "shortcode": "family_man_man_boy_boy",
        "glyph": "👨‍👨‍👦‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man"
        ],
        "aliases": [
          "family_mmbb"
        ]
      },
      {
        "shortcode": "family_man_man_girl_girl",
        "glyph": "👨‍👨‍👧‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mmgg"
        ]
      },
      {
        "shortcode": "family_woman_woman_boy",
        "glyph": "👩‍👩‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "woman"
        ],
        "aliases": [
          "family_wwb"
        ]
      },
      {
        "shortcode": "family_woman_woman_girl",
        "glyph": "👩‍👩‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wwg"
        ]
      },
      {
        "shortcode": "family_woman_woman_girl_boy",
        "glyph": "👩‍👩‍👧‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wwgb"
        ]
      },
      {
        "shortcode": "family_woman_woman_boy_boy",
        "glyph": "👩‍👩‍👦‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "woman"
        ],
        "aliases": [
          "family_wwbb"
        ]
      },
      {
        "shortcode": "family_woman_woman_girl_girl",
        "glyph": "👩‍👩‍👧‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wwgg"
        ]
      },
      {
        "shortcode": "family_man_boy",
        "glyph": "👨‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man"
        ],
        "aliases": [
          "family_mb"
        ]
      },
      {
        "shortcode": "family_man_boy_boy",
        "glyph": "👨‍👦‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "man"
        ],
        "aliases": [
          "family_mbb"
        ]
      },
      {
        "shortcode": "family_man_girl",
        "glyph": "👨‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mg"
        ]
      },
      {
        "shortcode": "family_man_girl_boy",
        "glyph": "👨‍👧‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mgb"
        ]
      },
      {
        "shortcode": "family_man_girl_girl",
        "glyph": "👨‍👧‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "man"
        ],
        "aliases": [
          "family_mgg"
        ]
      },
      {
        "shortcode": "family_woman_boy",
        "glyph": "👩‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "woman"
        ],
        "aliases": [
          "family_wb"
        ]
      },
      {
        "shortcode": "family_woman_boy_boy",
        "glyph": "👩‍👦‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "woman"
        ],
        "aliases": [
          "family_wbb"
        ]
      },
      {
        "shortcode": "family_woman_girl",
        "glyph": "👩‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wg"
        ]
      },
      {
        "shortcode": "family_woman_girl_boy",
        "glyph": "👩‍👧‍👦",
        "keywords": [
          "boy",
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wgb"
        ]
      },
      {
        "shortcode": "family_woman_girl_girl",
        "glyph": "👩‍👧‍👧",
        "keywords": [
          "child",
          "family",
          "girl",
          "woman"
        ],
        "aliases": [
          "family_wgg"
        ]
      },
      {
        "shortcode": "speaking_head",
        "glyph": "🗣️",
        "keywords": [
          "face",
          "head",
          "silhouette",
          "speak",
          "speaking"
        ]
      },
      {
        "shortcode": "bust_in_silhouette",
        "glyph": "👤",
        "keywords": [
          "bust",
          "mysterious",
          "shadow",
          "silhouette"
        ]
      },
      {
        "shortcode": "busts_in_silhouette",
        "glyph": "👥",
        "keywords": [
          "bff",
          "bust",
          "busts",
          "everyone",
          "friend",
          "friends",
          "people",
          "silhouette"
        ]
      },
      {
        "shortcode": "people_hugging",
        "glyph": "🫂",
        "keywords": [
          "comfort",
          "embrace",
          "farewell",
          "friendship",
          "goodbye",
          "hello",
          "hug",
          "hugging",
          "love",
          "people",
          "thanks"
        ]
      },
      {
        "shortcode": "family",
        "glyph": "👪️",
        "keywords": [
          "child"
        ]
      },
      {
        "shortcode": "family_aac",
        "glyph": "🧑‍🧑‍🧒",
        "keywords": [
          "adult",
          "child",
          "family"
        ]
      },
      {
        "shortcode": "family_aacc",
        "glyph": "🧑‍🧑‍🧒‍🧒",
        "keywords": [
          "adult",
          "child",
          "family"
        ]
      },
      {
        "shortcode": "family_aa",
        "glyph": "🧑‍🧒",
        "keywords": [
          "adult",
          "child",
          "family"
        ],
        "aliases": [
          "family_ac"
        ]
      },
      {
        "shortcode": "family_acc",
        "glyph": "🧑‍🧒‍🧒",
        "keywords": [
          "adult",
          "child",
          "family"
        ]
      },
      {
        "shortcode": "footprints",
        "glyph": "👣",
        "keywords": [
          "barefoot",
          "clothing",
          "footprint",
          "omw",
          "print",
          "walk"
        ]
      },
      {
        "shortcode": "fingerprint",
        "glyph": "🫆",
        "keywords": [
          "clue",
          "crime",
          "detective",
          "forensics",
          "identity",
          "mystery",
          "print",
          "safety",
          "trace"
        ]
      }
    ]
  },
  {
    "id": "nature",
    "icon": "🐱",
    "name": "Animals & Nature",
    "entries": [
      {
        "shortcode": "monkey_face",
        "glyph": "🐵",
        "keywords": [
          "animal",
          "banana",
          "face",
          "monkey"
        ]
      },
      {
        "shortcode": "monkey",
        "glyph": "🐒",
        "keywords": [
          "animal",
          "banana"
        ]
      },
      {
        "shortcode": "gorilla",
        "glyph": "🦍",
        "keywords": [
          "animal"
        ]
      },
      {
        "shortcode": "orangutan",
        "glyph": "🦧",
        "keywords": [
          "animal",
          "ape",
          "monkey"
        ]
      },
      {
        "shortcode": "dog",
        "glyph": "🐶",
        "keywords": [
          "adorbs",
          "animal",
          "dog",
          "face",
          "pet",
          "puppies",
          "puppy"
        ],
        "aliases": [
          "dog_face"
        ]
      },
      {
        "shortcode": "dog2",
        "glyph": "🐕️",
        "keywords": [
          "animal",
          "animals",
          "dogs",
          "pet"
        ],
        "aliases": [
          "dog"
        ]
      },
      {
        "shortcode": "guide_dog",
        "glyph": "🦮",
        "keywords": [
          "accessibility",
          "animal",
          "blind",
          "dog",
          "guide"
        ]
      },
      {
        "shortcode": "service_dog",
        "glyph": "🐕‍🦺",
        "keywords": [
          "accessibility",
          "animal",
          "assistance",
          "dog",
          "service"
        ]
      },
      {
        "shortcode": "poodle",
        "glyph": "🐩",
        "keywords": [
          "animal",
          "dog",
          "fluffy"
        ]
      },
      {
        "shortcode": "wolf",
        "glyph": "🐺",
        "keywords": [
          "animal",
          "face"
        ],
        "aliases": [
          "wolf_face"
        ]
      },
      {
        "shortcode": "fox_face",
        "glyph": "🦊",
        "keywords": [
          "animal",
          "face"
        ],
        "aliases": [
          "fox"
        ]
      },
      {
        "shortcode": "raccoon",
        "glyph": "🦝",
        "keywords": [
          "animal",
          "curious",
          "sly"
        ]
      },
      {
        "shortcode": "cat",
        "glyph": "🐱",
        "keywords": [
          "animal",
          "cat",
          "face",
          "kitten",
          "kitty",
          "pet"
        ],
        "aliases": [
          "cat_face"
        ]
      },
      {
        "shortcode": "cat2",
        "glyph": "🐈️",
        "keywords": [
          "animal",
          "animals",
          "cats",
          "kitten",
          "pet"
        ],
        "aliases": [
          "cat"
        ]
      },
      {
        "shortcode": "black_cat",
        "glyph": "🐈‍⬛",
        "keywords": [
          "animal",
          "black",
          "cat",
          "feline",
          "halloween",
          "meow",
          "unlucky"
        ]
      },
      {
        "shortcode": "lion",
        "glyph": "🦁",
        "keywords": [
          "alpha",
          "animal",
          "face",
          "leo",
          "mane",
          "order",
          "rawr",
          "roar",
          "safari",
          "strong",
          "zodiac"
        ],
        "aliases": [
          "lion_face"
        ]
      },
      {
        "shortcode": "tiger",
        "glyph": "🐯",
        "keywords": [
          "animal",
          "big",
          "cat",
          "face",
          "predator",
          "tiger"
        ],
        "aliases": [
          "tiger_face"
        ]
      },
      {
        "shortcode": "tiger2",
        "glyph": "🐅",
        "keywords": [
          "animal",
          "big",
          "cat",
          "predator",
          "zoo"
        ],
        "aliases": [
          "tiger"
        ]
      },
      {
        "shortcode": "leopard",
        "glyph": "🐆",
        "keywords": [
          "animal",
          "big",
          "cat",
          "predator",
          "zoo"
        ]
      },
      {
        "shortcode": "horse",
        "glyph": "🐴",
        "keywords": [
          "animal",
          "dressage",
          "equine",
          "face",
          "farm",
          "horse",
          "horses"
        ],
        "aliases": [
          "horse_face"
        ]
      },
      {
        "shortcode": "moose",
        "glyph": "🫎",
        "keywords": [
          "alces",
          "animal",
          "antlers",
          "elk",
          "mammal"
        ]
      },
      {
        "shortcode": "donkey",
        "glyph": "🫏",
        "keywords": [
          "animal",
          "ass",
          "burro",
          "hinny",
          "mammal",
          "mule",
          "stubborn"
        ]
      },
      {
        "shortcode": "racehorse",
        "glyph": "🐎",
        "keywords": [
          "animal",
          "equestrian",
          "farm",
          "racehorse",
          "racing"
        ],
        "aliases": [
          "horse"
        ]
      },
      {
        "shortcode": "unicorn",
        "glyph": "🦄",
        "keywords": [
          "face"
        ],
        "aliases": [
          "unicorn_face"
        ]
      },
      {
        "shortcode": "zebra",
        "glyph": "🦓",
        "keywords": [
          "animal",
          "stripe"
        ]
      },
      {
        "shortcode": "deer",
        "glyph": "🦌",
        "keywords": [
          "animal"
        ]
      },
      {
        "shortcode": "bison",
        "glyph": "🦬",
        "keywords": [
          "animal",
          "buffalo",
          "herd",
          "wisent"
        ]
      },
      {
        "shortcode": "cow",
        "glyph": "🐮",
        "keywords": [
          "animal",
          "cow",
          "face",
          "farm",
          "milk",
          "moo"
        ],
        "aliases": [
          "cow_face"
        ]
      },
      {
        "shortcode": "ox",
        "glyph": "🐂",
        "keywords": [
          "animal",
          "animals",
          "bull",
          "farm",
          "taurus",
          "zodiac"
        ]
      },
      {
        "shortcode": "water_buffalo",
        "glyph": "🐃",
        "keywords": [
          "animal",
          "buffalo",
          "water",
          "zoo"
        ]
      },
      {
        "shortcode": "cow2",
        "glyph": "🐄",
        "keywords": [
          "animal",
          "animals",
          "farm",
          "milk",
          "moo"
        ],
        "aliases": [
          "cow"
        ]
      },
      {
        "shortcode": "pig",
        "glyph": "🐷",
        "keywords": [
          "animal",
          "bacon",
          "face",
          "farm",
          "pig",
          "pork"
        ],
        "aliases": [
          "pig_face"
        ]
      },
      {
        "shortcode": "pig2",
        "glyph": "🐖",
        "keywords": [
          "animal",
          "bacon",
          "farm",
          "pork",
          "sow"
        ],
        "aliases": [
          "pig"
        ]
      },
      {
        "shortcode": "boar",
        "glyph": "🐗",
        "keywords": [
          "animal",
          "pig"
        ]
      },
      {
        "shortcode": "pig_nose",
        "glyph": "🐽",
        "keywords": [
          "animal",
          "face",
          "farm",
          "nose",
          "pig",
          "smell",
          "snout"
        ]
      },
      {
        "shortcode": "ram",
        "glyph": "🐏",
        "keywords": [
          "animal",
          "aries",
          "horns",
          "male",
          "sheep",
          "zodiac",
          "zoo"
        ]
      },
      {
        "shortcode": "sheep",
        "glyph": "🐑",
        "keywords": [
          "animal",
          "baa",
          "farm",
          "female",
          "fluffy",
          "lamb",
          "sheep",
          "wool"
        ],
        "aliases": [
          "ewe"
        ]
      },
      {
        "shortcode": "goat",
        "glyph": "🐐",
        "keywords": [
          "animal",
          "capricorn",
          "farm",
          "milk",
          "zodiac"
        ]
      },
      {
        "shortcode": "dromedary_camel",
        "glyph": "🐪",
        "keywords": [
          "animal",
          "desert",
          "dromedary",
          "hump",
          "one"
        ]
      },
      {
        "shortcode": "camel",
        "glyph": "🐫",
        "keywords": [
          "animal",
          "bactrian",
          "camel",
          "desert",
          "hump",
          "two",
          "two-hump"
        ]
      },
      {
        "shortcode": "llama",
        "glyph": "🦙",
        "keywords": [
          "alpaca",
          "animal",
          "guanaco",
          "vicuña",
          "wool"
        ]
      },
      {
        "shortcode": "giraffe",
        "glyph": "🦒",
        "keywords": [
          "animal",
          "spots"
        ]
      },
      {
        "shortcode": "elephant",
        "glyph": "🐘",
        "keywords": [
          "animal"
        ]
      },
      {
        "shortcode": "mammoth",
        "glyph": "🦣",
        "keywords": [
          "animal",
          "extinction",
          "large",
          "tusk",
          "wooly"
        ]
      },
      {
        "shortcode": "rhinoceros",
        "glyph": "🦏",
        "keywords": [
          "animal"
        ],
        "aliases": [
          "rhino"
        ]
      },
      {
        "shortcode": "hippopotamus",
        "glyph": "🦛",
        "keywords": [
          "animal",
          "hippo"
        ],
        "aliases": [
          "hippo"
        ]
      },
      {
        "shortcode": "mouse",
        "glyph": "🐭",
        "keywords": [
          "animal",
          "face",
          "mouse"
        ],
        "aliases": [
          "mouse_face"
        ]
      },
      {
        "shortcode": "mouse2",
        "glyph": "🐁",
        "keywords": [
          "animal",
          "animals"
        ],
        "aliases": [
          "mouse"
        ]
      },
      {
        "shortcode": "rat",
        "glyph": "🐀",
        "keywords": [
          "animal"
        ]
      },
      {
        "shortcode": "hamster",
        "glyph": "🐹",
        "keywords": [
          "animal",
          "face",
          "pet"
        ],
        "aliases": [
          "hamster_face"
        ]
      },
      {
        "shortcode": "rabbit",
        "glyph": "🐰",
        "keywords": [
          "animal",
          "bunny",
          "face",
          "pet",
          "rabbit"
        ],
        "aliases": [
          "rabbit_face"
        ]
      },
      {
        "shortcode": "rabbit2",
        "glyph": "🐇",
        "keywords": [
          "animal",
          "bunny",
          "pet"
        ],
        "aliases": [
          "rabbit"
        ]
      },
      {
        "shortcode": "chipmunk",
        "glyph": "🐿️",
        "keywords": [
          "animal",
          "squirrel"
        ]
      },
      {
        "shortcode": "beaver",
        "glyph": "🦫",
        "keywords": [
          "animal",
          "dam",
          "teeth"
        ]
      },
      {
        "shortcode": "hedgehog",
        "glyph": "🦔",
        "keywords": [
          "animal",
          "spiny"
        ]
      },
      {
        "shortcode": "bat",
        "glyph": "🦇",
        "keywords": [
          "animal",
          "vampire"
        ]
      },
      {
        "shortcode": "bear",
        "glyph": "🐻",
        "keywords": [
          "animal",
          "face",
          "grizzly",
          "growl",
          "honey"
        ],
        "aliases": [
          "bear_face"
        ]
      },
      {
        "shortcode": "polar_bear",
        "glyph": "🐻‍❄️",
        "keywords": [
          "animal",
          "arctic",
          "bear",
          "polar",
          "white"
        ],
        "aliases": [
          "polar_bear_face"
        ]
      },
      {
        "shortcode": "koala",
        "glyph": "🐨",
        "keywords": [
          "animal",
          "australia",
          "bear",
          "down",
          "face",
          "marsupial",
          "under"
        ],
        "aliases": [
          "koala_face"
        ]
      },
      {
        "shortcode": "panda_face",
        "glyph": "🐼",
        "keywords": [
          "animal",
          "bamboo",
          "face"
        ],
        "aliases": [
          "panda"
        ]
      },
      {
        "shortcode": "sloth",
        "glyph": "🦥",
        "keywords": [
          "lazy",
          "slow"
        ]
      },
      {
        "shortcode": "otter",
        "glyph": "🦦",
        "keywords": [
          "animal",
          "fishing",
          "playful"
        ]
      },
      {
        "shortcode": "skunk",
        "glyph": "🦨",
        "keywords": [
          "animal",
          "stink"
        ]
      },
      {
        "shortcode": "kangaroo",
        "glyph": "🦘",
        "keywords": [
          "animal",
          "joey",
          "jump",
          "marsupial"
        ]
      },
      {
        "shortcode": "badger",
        "glyph": "🦡",
        "keywords": [
          "animal",
          "honey",
          "pester"
        ]
      },
      {
        "shortcode": "feet",
        "glyph": "🐾",
        "keywords": [
          "feet",
          "paw",
          "paws",
          "print",
          "prints"
        ],
        "aliases": [
          "paw_prints"
        ]
      },
      {
        "shortcode": "turkey",
        "glyph": "🦃",
        "keywords": [
          "bird",
          "gobble",
          "thanksgiving"
        ]
      },
      {
        "shortcode": "chicken",
        "glyph": "🐔",
        "keywords": [
          "animal",
          "bird",
          "ornithology"
        ],
        "aliases": [
          "chicken_face"
        ]
      },
      {
        "shortcode": "rooster",
        "glyph": "🐓",
        "keywords": [
          "animal",
          "bird",
          "ornithology"
        ]
      },
      {
        "shortcode": "hatching_chick",
        "glyph": "🐣",
        "keywords": [
          "animal",
          "baby",
          "bird",
          "chick",
          "egg",
          "hatching"
        ]
      },
      {
        "shortcode": "baby_chick",
        "glyph": "🐤",
        "keywords": [
          "animal",
          "baby",
          "bird",
          "chick",
          "ornithology"
        ]
      },
      {
        "shortcode": "hatched_chick",
        "glyph": "🐥",
        "keywords": [
          "animal",
          "baby",
          "bird",
          "chick",
          "front-facing",
          "newborn",
          "ornithology"
        ]
      },
      {
        "shortcode": "bird",
        "glyph": "🐦️",
        "keywords": [
          "animal",
          "ornithology"
        ],
        "aliases": [
          "bird_face"
        ]
      },
      {
        "shortcode": "penguin",
        "glyph": "🐧",
        "keywords": [
          "animal",
          "antarctica",
          "bird",
          "ornithology"
        ],
        "aliases": [
          "penguin_face"
        ]
      },
      {
        "shortcode": "dove",
        "glyph": "🕊️",
        "keywords": [
          "bird",
          "fly",
          "ornithology",
          "peace"
        ]
      },
      {
        "shortcode": "eagle",
        "glyph": "🦅",
        "keywords": [
          "animal",
          "bird",
          "ornithology"
        ]
      },
      {
        "shortcode": "duck",
        "glyph": "🦆",
        "keywords": [
          "animal",
          "bird",
          "ornithology"
        ]
      },
      {
        "shortcode": "swan",
        "glyph": "🦢",
        "keywords": [
          "animal",
          "bird",
          "cygnet",
          "duckling",
          "ornithology",
          "ugly"
        ]
      },
      {
        "shortcode": "owl",
        "glyph": "🦉",
        "keywords": [
          "animal",
          "bird",
          "ornithology",
          "wise"
        ]
      },
      {
        "shortcode": "dodo",
        "glyph": "🦤",
        "keywords": [
          "animal",
          "bird",
          "extinction",
          "large",
          "ornithology"
        ]
      },
      {
        "shortcode": "feather",
        "glyph": "🪶",
        "keywords": [
          "bird",
          "flight",
          "light",
          "plumage"
        ]
      },
      {
        "shortcode": "flamingo",
        "glyph": "🦩",
        "keywords": [
          "animal",
          "bird",
          "flamboyant",
          "ornithology",
          "tropical"
        ]
      },
      {
        "shortcode": "peacock",
        "glyph": "🦚",
        "keywords": [
          "animal",
          "bird",
          "colorful",
          "ornithology",
          "ostentatious",
          "peahen",
          "pretty",
          "proud"
        ]
      },
      {
        "shortcode": "parrot",
        "glyph": "🦜",
        "keywords": [
          "animal",
          "bird",
          "ornithology",
          "pirate",
          "talk"
        ]
      },
      {
        "shortcode": "wing",
        "glyph": "🪽",
        "keywords": [
          "angelic",
          "ascend",
          "aviation",
          "bird",
          "fly",
          "flying",
          "heavenly",
          "mythology",
          "soar"
        ]
      },
      {
        "shortcode": "black_bird",
        "glyph": "🐦‍⬛",
        "keywords": [
          "animal",
          "beak",
          "bird",
          "black",
          "caw",
          "corvid",
          "crow",
          "ornithology",
          "raven",
          "rook"
        ]
      },
      {
        "shortcode": "goose",
        "glyph": "🪿",
        "keywords": [
          "animal",
          "bird",
          "duck",
          "flock",
          "fowl",
          "gaggle",
          "gander",
          "geese",
          "honk",
          "ornithology",
          "silly"
        ]
      },
      {
        "shortcode": "phoenix",
        "glyph": "🐦‍🔥",
        "keywords": [
          "ascend",
          "ascension",
          "emerge",
          "fantasy",
          "firebird",
          "glory",
          "immortal",
          "rebirth",
          "reincarnation",
          "reinvent",
          "renewal",
          "revival",
          "revive",
          "rise",
          "transform"
        ]
      },
      {
        "shortcode": "frog",
        "glyph": "🐸",
        "keywords": [
          "animal",
          "face"
        ],
        "aliases": [
          "frog_face"
        ]
      },
      {
        "shortcode": "crocodile",
        "glyph": "🐊",
        "keywords": [
          "animal",
          "zoo"
        ]
      },
      {
        "shortcode": "turtle",
        "glyph": "🐢",
        "keywords": [
          "animal",
          "terrapin",
          "tortoise"
        ]
      },
      {
        "shortcode": "lizard",
        "glyph": "🦎",
        "keywords": [
          "animal",
          "reptile"
        ]
      },
      {
        "shortcode": "snake",
        "glyph": "🐍",
        "keywords": [
          "animal",
          "bearer",
          "ophiuchus",
          "serpent",
          "zodiac"
        ]
      },
      {
        "shortcode": "dragon_face",
        "glyph": "🐲",
        "keywords": [
          "animal",
          "dragon",
          "face",
          "fairy",
          "fairytale",
          "tale"
        ]
      },
      {
        "shortcode": "dragon",
        "glyph": "🐉",
        "keywords": [
          "animal",
          "fairy",
          "fairytale",
          "knights",
          "tale"
        ]
      },
      {
        "shortcode": "sauropod",
        "glyph": "🦕",
        "keywords": [
          "brachiosaurus",
          "brontosaurus",
          "dinosaur",
          "diplodocus"
        ]
      },
      {
        "shortcode": "t-rex",
        "glyph": "🦖",
        "keywords": [
          "dinosaur",
          "rex",
          "t",
          "t-rex",
          "tyrannosaurus"
        ],
        "aliases": [
          "trex"
        ]
      },
      {
        "shortcode": "whale",
        "glyph": "🐳",
        "keywords": [
          "animal",
          "beach",
          "face",
          "ocean",
          "spouting",
          "whale"
        ],
        "aliases": [
          "spouting_whale"
        ]
      },
      {
        "shortcode": "whale2",
        "glyph": "🐋",
        "keywords": [
          "animal",
          "beach",
          "ocean"
        ],
        "aliases": [
          "whale"
        ]
      },
      {
        "shortcode": "dolphin",
        "glyph": "🐬",
        "keywords": [
          "animal",
          "beach",
          "flipper",
          "ocean"
        ],
        "aliases": [
          "flipper"
        ]
      },
      {
        "shortcode": "orca",
        "glyph": "🫍",
        "keywords": [
          "marine",
          "ocean",
          "whale"
        ]
      },
      {
        "shortcode": "seal",
        "glyph": "🦭",
        "keywords": [
          "animal",
          "lion",
          "ocean",
          "sea"
        ]
      },
      {
        "shortcode": "fish",
        "glyph": "🐟️",
        "keywords": [
          "animal",
          "dinner",
          "fishes",
          "fishing",
          "pisces",
          "zodiac"
        ]
      },
      {
        "shortcode": "tropical_fish",
        "glyph": "🐠",
        "keywords": [
          "animal",
          "fish",
          "fishes",
          "tropical"
        ]
      },
      {
        "shortcode": "blowfish",
        "glyph": "🐡",
        "keywords": [
          "animal",
          "fish"
        ]
      },
      {
        "shortcode": "shark",
        "glyph": "🦈",
        "keywords": [
          "animal",
          "fish"
        ]
      },
      {
        "shortcode": "octopus",
        "glyph": "🐙",
        "keywords": [
          "animal",
          "creature",
          "ocean"
        ]
      },
      {
        "shortcode": "shell",
        "glyph": "🐚",
        "keywords": [
          "animal",
          "beach",
          "conch",
          "sea",
          "shell",
          "spiral"
        ]
      },
      {
        "shortcode": "coral",
        "glyph": "🪸",
        "keywords": [
          "change",
          "climate",
          "ocean",
          "reef",
          "sea"
        ]
      },
      {
        "shortcode": "jellyfish",
        "glyph": "🪼",
        "keywords": [
          "animal",
          "aquarium",
          "burn",
          "invertebrate",
          "jelly",
          "life",
          "marine",
          "ocean",
          "ouch",
          "plankton",
          "sea",
          "sting",
          "stinger",
          "tentacles"
        ]
      },
      {
        "shortcode": "crab",
        "glyph": "🦀",
        "keywords": [
          "cancer",
          "zodiac"
        ]
      },
      {
        "shortcode": "lobster",
        "glyph": "🦞",
        "keywords": [
          "animal",
          "bisque",
          "claws",
          "seafood"
        ]
      },
      {
        "shortcode": "shrimp",
        "glyph": "🦐",
        "keywords": [
          "food",
          "shellfish",
          "small"
        ]
      },
      {
        "shortcode": "squid",
        "glyph": "🦑",
        "keywords": [
          "animal",
          "food",
          "mollusk"
        ]
      },
      {
        "shortcode": "oyster",
        "glyph": "🦪",
        "keywords": [
          "diving",
          "pearl"
        ]
      },
      {
        "shortcode": "snail",
        "glyph": "🐌",
        "keywords": [
          "animal",
          "escargot",
          "garden",
          "nature",
          "slug"
        ]
      },
      {
        "shortcode": "butterfly",
        "glyph": "🦋",
        "keywords": [
          "insect",
          "pretty"
        ]
      },
      {
        "shortcode": "bug",
        "glyph": "🐛",
        "keywords": [
          "animal",
          "garden",
          "insect"
        ]
      },
      {
        "shortcode": "ant",
        "glyph": "🐜",
        "keywords": [
          "animal",
          "garden",
          "insect"
        ]
      },
      {
        "shortcode": "bee",
        "glyph": "🐝",
        "keywords": [
          "animal",
          "bee",
          "bumblebee",
          "honey",
          "insect",
          "nature",
          "spring"
        ],
        "aliases": [
          "honeybee"
        ]
      },
      {
        "shortcode": "beetle",
        "glyph": "🪲",
        "keywords": [
          "animal",
          "bug",
          "insect"
        ]
      },
      {
        "shortcode": "lady_beetle",
        "glyph": "🐞",
        "keywords": [
          "animal",
          "beetle",
          "garden",
          "insect",
          "lady",
          "ladybird",
          "ladybug",
          "nature"
        ]
      },
      {
        "shortcode": "cricket",
        "glyph": "🦗",
        "keywords": [
          "animal",
          "bug",
          "grasshopper",
          "insect",
          "orthoptera"
        ]
      },
      {
        "shortcode": "cockroach",
        "glyph": "🪳",
        "keywords": [
          "animal",
          "insect",
          "pest",
          "roach"
        ]
      },
      {
        "shortcode": "spider",
        "glyph": "🕷️",
        "keywords": [
          "animal",
          "insect"
        ]
      },
      {
        "shortcode": "spider_web",
        "glyph": "🕸️",
        "keywords": [
          "spider",
          "web"
        ]
      },
      {
        "shortcode": "scorpion",
        "glyph": "🦂",
        "keywords": [
          "scorpio",
          "scorpius",
          "zodiac"
        ]
      },
      {
        "shortcode": "mosquito",
        "glyph": "🦟",
        "keywords": [
          "bite",
          "disease",
          "fever",
          "insect",
          "malaria",
          "pest",
          "virus"
        ]
      },
      {
        "shortcode": "fly",
        "glyph": "🪰",
        "keywords": [
          "animal",
          "disease",
          "insect",
          "maggot",
          "pest",
          "rotting"
        ]
      },
      {
        "shortcode": "worm",
        "glyph": "🪱",
        "keywords": [
          "animal",
          "annelid",
          "earthworm",
          "parasite"
        ]
      },
      {
        "shortcode": "microbe",
        "glyph": "🦠",
        "keywords": [
          "amoeba",
          "bacteria",
          "science",
          "virus"
        ]
      },
      {
        "shortcode": "bouquet",
        "glyph": "💐",
        "keywords": [
          "anniversary",
          "birthday",
          "date",
          "flower",
          "love",
          "plant",
          "romance"
        ]
      },
      {
        "shortcode": "cherry_blossom",
        "glyph": "🌸",
        "keywords": [
          "blossom",
          "cherry",
          "flower",
          "plant",
          "spring",
          "springtime"
        ]
      },
      {
        "shortcode": "white_flower",
        "glyph": "💮",
        "keywords": [
          "flower",
          "white"
        ]
      },
      {
        "shortcode": "lotus",
        "glyph": "🪷",
        "keywords": [
          "beauty",
          "buddhism",
          "calm",
          "flower",
          "hinduism",
          "peace",
          "purity",
          "serenity"
        ]
      },
      {
        "shortcode": "rosette",
        "glyph": "🏵️",
        "keywords": [
          "plant"
        ]
      },
      {
        "shortcode": "rose",
        "glyph": "🌹",
        "keywords": [
          "beauty",
          "elegant",
          "flower",
          "love",
          "plant",
          "red",
          "valentine"
        ]
      },
      {
        "shortcode": "wilted_flower",
        "glyph": "🥀",
        "keywords": [
          "dying",
          "flower",
          "wilted"
        ]
      },
      {
        "shortcode": "hibiscus",
        "glyph": "🌺",
        "keywords": [
          "flower",
          "plant"
        ]
      },
      {
        "shortcode": "sunflower",
        "glyph": "🌻",
        "keywords": [
          "flower",
          "outdoors",
          "plant",
          "sun"
        ]
      },
      {
        "shortcode": "blossom",
        "glyph": "🌼",
        "keywords": [
          "buttercup",
          "dandelion",
          "flower",
          "plant"
        ]
      },
      {
        "shortcode": "tulip",
        "glyph": "🌷",
        "keywords": [
          "blossom",
          "flower",
          "growth",
          "plant"
        ]
      },
      {
        "shortcode": "hyacinth",
        "glyph": "🪻",
        "keywords": [
          "bloom",
          "bluebonnet",
          "flower",
          "indigo",
          "lavender",
          "lilac",
          "lupine",
          "plant",
          "purple",
          "shrub",
          "snapdragon",
          "spring",
          "violet"
        ]
      },
      {
        "shortcode": "seedling",
        "glyph": "🌱",
        "keywords": [
          "plant",
          "sapling",
          "sprout",
          "young"
        ]
      },
      {
        "shortcode": "potted_plant",
        "glyph": "🪴",
        "keywords": [
          "decor",
          "grow",
          "house",
          "nurturing",
          "plant",
          "pot",
          "potted"
        ]
      },
      {
        "shortcode": "evergreen_tree",
        "glyph": "🌲",
        "keywords": [
          "christmas",
          "evergreen",
          "forest",
          "pine",
          "tree"
        ]
      },
      {
        "shortcode": "deciduous_tree",
        "glyph": "🌳",
        "keywords": [
          "deciduous",
          "forest",
          "green",
          "habitat",
          "shedding",
          "tree"
        ]
      },
      {
        "shortcode": "palm_tree",
        "glyph": "🌴",
        "keywords": [
          "beach",
          "palm",
          "plant",
          "tree",
          "tropical"
        ]
      },
      {
        "shortcode": "cactus",
        "glyph": "🌵",
        "keywords": [
          "desert",
          "drought",
          "nature",
          "plant"
        ]
      },
      {
        "shortcode": "ear_of_rice",
        "glyph": "🌾",
        "keywords": [
          "ear",
          "grain",
          "grains",
          "plant",
          "rice",
          "sheaf"
        ],
        "aliases": [
          "sheaf_of_rice"
        ]
      },
      {
        "shortcode": "herb",
        "glyph": "🌿",
        "keywords": [
          "leaf",
          "plant"
        ]
      },
      {
        "shortcode": "shamrock",
        "glyph": "☘️",
        "keywords": [
          "irish",
          "plant"
        ]
      },
      {
        "shortcode": "four_leaf_clover",
        "glyph": "🍀",
        "keywords": [
          "4",
          "clover",
          "four",
          "four-leaf",
          "irish",
          "leaf",
          "lucky",
          "plant"
        ]
      },
      {
        "shortcode": "maple_leaf",
        "glyph": "🍁",
        "keywords": [
          "falling",
          "leaf",
          "maple"
        ]
      },
      {
        "shortcode": "fallen_leaf",
        "glyph": "🍂",
        "keywords": [
          "autumn",
          "fall",
          "fallen",
          "falling",
          "leaf"
        ]
      },
      {
        "shortcode": "leaves",
        "glyph": "🍃",
        "keywords": [
          "blow",
          "flutter",
          "fluttering",
          "leaf",
          "wind"
        ]
      },
      {
        "shortcode": "empty_nest",
        "glyph": "🪹",
        "keywords": [
          "branch",
          "empty",
          "home",
          "nest",
          "nesting"
        ],
        "aliases": [
          "nest"
        ]
      },
      {
        "shortcode": "nest_with_eggs",
        "glyph": "🪺",
        "keywords": [
          "bird",
          "branch",
          "egg",
          "eggs",
          "nest",
          "nesting"
        ]
      },
      {
        "shortcode": "mushroom",
        "glyph": "🍄",
        "keywords": [
          "fungus",
          "toadstool"
        ]
      },
      {
        "shortcode": "leafless_tree",
        "glyph": "🪾",
        "keywords": [
          "bare",
          "barren",
          "branches",
          "dead",
          "drought",
          "leafless",
          "tree",
          "trunk",
          "winter",
          "wood"
        ]
      }
    ]
  },
  {
    "id": "food",
    "icon": "🍕",
    "name": "Food & Drink",
    "entries": [
      {
        "shortcode": "grapes",
        "glyph": "🍇",
        "keywords": [
          "dionysus",
          "fruit",
          "grape"
        ]
      },
      {
        "shortcode": "melon",
        "glyph": "🍈",
        "keywords": [
          "cantaloupe",
          "fruit"
        ]
      },
      {
        "shortcode": "watermelon",
        "glyph": "🍉",
        "keywords": [
          "fruit"
        ]
      },
      {
        "shortcode": "mandarin",
        "glyph": "🍊",
        "keywords": [
          "c",
          "citrus",
          "fruit",
          "nectarine",
          "orange",
          "vitamin"
        ],
        "aliases": [
          "orange",
          "tangerine"
        ]
      },
      {
        "shortcode": "lemon",
        "glyph": "🍋",
        "keywords": [
          "citrus",
          "fruit",
          "sour"
        ]
      },
      {
        "shortcode": "lime",
        "glyph": "🍋‍🟩",
        "keywords": [
          "acidity",
          "citrus",
          "cocktail",
          "fruit",
          "garnish",
          "key",
          "margarita",
          "mojito",
          "refreshing",
          "salsa",
          "sour",
          "tangy",
          "tequila",
          "tropical",
          "zest"
        ]
      },
      {
        "shortcode": "banana",
        "glyph": "🍌",
        "keywords": [
          "fruit",
          "potassium"
        ]
      },
      {
        "shortcode": "pineapple",
        "glyph": "🍍",
        "keywords": [
          "colada",
          "fruit",
          "pina",
          "tropical"
        ]
      },
      {
        "shortcode": "mango",
        "glyph": "🥭",
        "keywords": [
          "food",
          "fruit",
          "tropical"
        ]
      },
      {
        "shortcode": "apple",
        "glyph": "🍎",
        "keywords": [
          "apple",
          "diet",
          "food",
          "fruit",
          "health",
          "red",
          "ripe"
        ],
        "aliases": [
          "red_apple"
        ]
      },
      {
        "shortcode": "green_apple",
        "glyph": "🍏",
        "keywords": [
          "apple",
          "fruit",
          "green"
        ]
      },
      {
        "shortcode": "pear",
        "glyph": "🍐",
        "keywords": [
          "fruit"
        ]
      },
      {
        "shortcode": "peach",
        "glyph": "🍑",
        "keywords": [
          "fruit"
        ]
      },
      {
        "shortcode": "cherries",
        "glyph": "🍒",
        "keywords": [
          "berries",
          "cherry",
          "fruit",
          "red"
        ]
      },
      {
        "shortcode": "strawberry",
        "glyph": "🍓",
        "keywords": [
          "berry",
          "fruit"
        ]
      },
      {
        "shortcode": "blueberries",
        "glyph": "🫐",
        "keywords": [
          "berries",
          "berry",
          "bilberry",
          "blue",
          "blueberry",
          "food",
          "fruit"
        ]
      },
      {
        "shortcode": "kiwi_fruit",
        "glyph": "🥝",
        "keywords": [
          "food",
          "fruit",
          "kiwi"
        ],
        "aliases": [
          "kiwi"
        ]
      },
      {
        "shortcode": "tomato",
        "glyph": "🍅",
        "keywords": [
          "food",
          "fruit",
          "vegetable"
        ]
      },
      {
        "shortcode": "olive",
        "glyph": "🫒",
        "keywords": [
          "food"
        ]
      },
      {
        "shortcode": "coconut",
        "glyph": "🥥",
        "keywords": [
          "colada",
          "palm",
          "piña"
        ]
      },
      {
        "shortcode": "avocado",
        "glyph": "🥑",
        "keywords": [
          "food",
          "fruit"
        ]
      },
      {
        "shortcode": "eggplant",
        "glyph": "🍆",
        "keywords": [
          "aubergine",
          "vegetable"
        ]
      },
      {
        "shortcode": "potato",
        "glyph": "🥔",
        "keywords": [
          "food",
          "vegetable"
        ]
      },
      {
        "shortcode": "carrot",
        "glyph": "🥕",
        "keywords": [
          "food",
          "vegetable"
        ]
      },
      {
        "shortcode": "corn",
        "glyph": "🌽",
        "keywords": [
          "corn",
          "crops",
          "ear",
          "farm",
          "maize",
          "maze"
        ],
        "aliases": [
          "ear_of_corn"
        ]
      },
      {
        "shortcode": "hot_pepper",
        "glyph": "🌶️",
        "keywords": [
          "hot",
          "pepper"
        ]
      },
      {
        "shortcode": "bell_pepper",
        "glyph": "🫑",
        "keywords": [
          "bell",
          "capsicum",
          "food",
          "pepper",
          "vegetable"
        ]
      },
      {
        "shortcode": "cucumber",
        "glyph": "🥒",
        "keywords": [
          "food",
          "pickle",
          "vegetable"
        ]
      },
      {
        "shortcode": "leafy_green",
        "glyph": "🥬",
        "keywords": [
          "bok",
          "burgers",
          "cabbage",
          "choy",
          "green",
          "kale",
          "leafy",
          "lettuce",
          "salad"
        ]
      },
      {
        "shortcode": "broccoli",
        "glyph": "🥦",
        "keywords": [
          "cabbage",
          "wild"
        ]
      },
      {
        "shortcode": "garlic",
        "glyph": "🧄",
        "keywords": [
          "flavoring"
        ]
      },
      {
        "shortcode": "onion",
        "glyph": "🧅",
        "keywords": [
          "flavoring"
        ]
      },
      {
        "shortcode": "peanuts",
        "glyph": "🥜",
        "keywords": [
          "food",
          "nut",
          "peanut",
          "vegetable"
        ]
      },
      {
        "shortcode": "beans",
        "glyph": "🫘",
        "keywords": [
          "food",
          "kidney",
          "legume",
          "small"
        ]
      },
      {
        "shortcode": "chestnut",
        "glyph": "🌰",
        "keywords": [
          "almond",
          "plant"
        ]
      },
      {
        "shortcode": "ginger_root",
        "glyph": "🫚",
        "keywords": [
          "beer",
          "ginger",
          "health",
          "herb",
          "natural",
          "root",
          "spice"
        ],
        "aliases": [
          "ginger"
        ]
      },
      {
        "shortcode": "pea_pod",
        "glyph": "🫛",
        "keywords": [
          "beans",
          "beanstalk",
          "edamame",
          "legume",
          "pea",
          "pod",
          "soybean",
          "vegetable",
          "veggie"
        ],
        "aliases": [
          "pea"
        ]
      },
      {
        "shortcode": "brown_mushroom",
        "glyph": "🍄‍🟫",
        "keywords": [
          "food",
          "fungi",
          "fungus",
          "mushroom",
          "nature",
          "pizza",
          "portobello",
          "shiitake",
          "shroom",
          "spore",
          "sprout",
          "toppings",
          "truffle",
          "vegetable",
          "vegetarian",
          "veggie"
        ]
      },
      {
        "shortcode": "root_vegetable",
        "glyph": "🫜",
        "keywords": [
          "beet",
          "food",
          "garden",
          "radish",
          "root",
          "salad",
          "turnip",
          "vegetable",
          "vegetarian"
        ]
      },
      {
        "shortcode": "bread",
        "glyph": "🍞",
        "keywords": [
          "carbs",
          "food",
          "grain",
          "loaf",
          "restaurant",
          "toast",
          "wheat"
        ]
      },
      {
        "shortcode": "croissant",
        "glyph": "🥐",
        "keywords": [
          "bread",
          "breakfast",
          "crescent",
          "food",
          "french",
          "roll"
        ]
      },
      {
        "shortcode": "baguette_bread",
        "glyph": "🥖",
        "keywords": [
          "baguette",
          "bread",
          "food",
          "french"
        ]
      },
      {
        "shortcode": "flatbread",
        "glyph": "🫓",
        "keywords": [
          "arepa",
          "bread",
          "food",
          "gordita",
          "lavash",
          "naan",
          "pita"
        ]
      },
      {
        "shortcode": "pretzel",
        "glyph": "🥨",
        "keywords": [
          "convoluted",
          "twisted"
        ]
      },
      {
        "shortcode": "bagel",
        "glyph": "🥯",
        "keywords": [
          "bakery",
          "bread",
          "breakfast",
          "schmear"
        ]
      },
      {
        "shortcode": "pancakes",
        "glyph": "🥞",
        "keywords": [
          "breakfast",
          "crêpe",
          "food",
          "hotcake",
          "pancake"
        ]
      },
      {
        "shortcode": "waffle",
        "glyph": "🧇",
        "keywords": [
          "breakfast",
          "indecisive",
          "iron"
        ]
      },
      {
        "shortcode": "cheese",
        "glyph": "🧀",
        "keywords": [
          "cheese",
          "wedge"
        ]
      },
      {
        "shortcode": "meat_on_bone",
        "glyph": "🍖",
        "keywords": [
          "bone",
          "meat"
        ]
      },
      {
        "shortcode": "poultry_leg",
        "glyph": "🍗",
        "keywords": [
          "bone",
          "chicken",
          "drumstick",
          "hungry",
          "leg",
          "poultry",
          "turkey"
        ]
      },
      {
        "shortcode": "cut_of_meat",
        "glyph": "🥩",
        "keywords": [
          "chop",
          "cut",
          "lambchop",
          "meat",
          "porkchop",
          "red",
          "steak"
        ]
      },
      {
        "shortcode": "bacon",
        "glyph": "🥓",
        "keywords": [
          "breakfast",
          "food",
          "meat"
        ]
      },
      {
        "shortcode": "hamburger",
        "glyph": "🍔",
        "keywords": [
          "burger",
          "eat",
          "fast",
          "food",
          "hungry"
        ]
      },
      {
        "shortcode": "fries",
        "glyph": "🍟",
        "keywords": [
          "fast",
          "food",
          "french",
          "fries"
        ],
        "aliases": [
          "french_fries"
        ]
      },
      {
        "shortcode": "pizza",
        "glyph": "🍕",
        "keywords": [
          "cheese",
          "food",
          "hungry",
          "pepperoni",
          "slice"
        ]
      },
      {
        "shortcode": "hotdog",
        "glyph": "🌭",
        "keywords": [
          "dog",
          "frankfurter",
          "hot",
          "hotdog",
          "sausage"
        ]
      },
      {
        "shortcode": "sandwich",
        "glyph": "🥪",
        "keywords": [
          "bread"
        ]
      },
      {
        "shortcode": "taco",
        "glyph": "🌮",
        "keywords": [
          "mexican"
        ]
      },
      {
        "shortcode": "burrito",
        "glyph": "🌯",
        "keywords": [
          "mexican",
          "wrap"
        ]
      },
      {
        "shortcode": "tamale",
        "glyph": "🫔",
        "keywords": [
          "food",
          "mexican",
          "pamonha",
          "wrapped"
        ]
      },
      {
        "shortcode": "stuffed_flatbread",
        "glyph": "🥙",
        "keywords": [
          "falafel",
          "flatbread",
          "food",
          "gyro",
          "kebab",
          "stuffed"
        ]
      },
      {
        "shortcode": "falafel",
        "glyph": "🧆",
        "keywords": [
          "chickpea",
          "meatball"
        ]
      },
      {
        "shortcode": "egg",
        "glyph": "🥚",
        "keywords": [
          "breakfast",
          "food"
        ]
      },
      {
        "shortcode": "fried_egg",
        "glyph": "🍳",
        "keywords": [
          "breakfast",
          "easy",
          "egg",
          "fry",
          "frying",
          "over",
          "pan",
          "restaurant",
          "side",
          "sunny",
          "up"
        ],
        "aliases": [
          "cooking"
        ]
      },
      {
        "shortcode": "shallow_pan_of_food",
        "glyph": "🥘",
        "keywords": [
          "casserole",
          "food",
          "paella",
          "pan",
          "shallow"
        ]
      },
      {
        "shortcode": "stew",
        "glyph": "🍲",
        "keywords": [
          "food",
          "pot",
          "soup",
          "stew"
        ],
        "aliases": [
          "pot_of_food"
        ]
      },
      {
        "shortcode": "fondue",
        "glyph": "🫕",
        "keywords": [
          "cheese",
          "chocolate",
          "food",
          "melted",
          "pot",
          "ski"
        ]
      },
      {
        "shortcode": "bowl_with_spoon",
        "glyph": "🥣",
        "keywords": [
          "bowl",
          "breakfast",
          "cereal",
          "congee",
          "oatmeal",
          "porridge",
          "spoon"
        ]
      },
      {
        "shortcode": "green_salad",
        "glyph": "🥗",
        "keywords": [
          "food",
          "green",
          "salad"
        ],
        "aliases": [
          "salad"
        ]
      },
      {
        "shortcode": "popcorn",
        "glyph": "🍿",
        "keywords": [
          "corn",
          "movie",
          "pop"
        ]
      },
      {
        "shortcode": "butter",
        "glyph": "🧈",
        "keywords": [
          "dairy"
        ]
      },
      {
        "shortcode": "salt",
        "glyph": "🧂",
        "keywords": [
          "condiment",
          "flavor",
          "mad",
          "salty",
          "shaker",
          "taste",
          "upset"
        ]
      },
      {
        "shortcode": "canned_food",
        "glyph": "🥫",
        "keywords": [
          "can",
          "canned",
          "food"
        ]
      },
      {
        "shortcode": "bento",
        "glyph": "🍱",
        "keywords": [
          "bento",
          "box",
          "food"
        ],
        "aliases": [
          "bento_box"
        ]
      },
      {
        "shortcode": "rice_cracker",
        "glyph": "🍘",
        "keywords": [
          "cracker",
          "food",
          "rice"
        ]
      },
      {
        "shortcode": "rice_ball",
        "glyph": "🍙",
        "keywords": [
          "ball",
          "food",
          "japanese",
          "rice"
        ]
      },
      {
        "shortcode": "rice",
        "glyph": "🍚",
        "keywords": [
          "cooked",
          "food",
          "rice"
        ],
        "aliases": [
          "cooked_rice"
        ]
      },
      {
        "shortcode": "curry",
        "glyph": "🍛",
        "keywords": [
          "curry",
          "food",
          "rice"
        ],
        "aliases": [
          "curry_rice"
        ]
      },
      {
        "shortcode": "ramen",
        "glyph": "🍜",
        "keywords": [
          "bowl",
          "chopsticks",
          "food",
          "noodle",
          "pho",
          "ramen",
          "soup",
          "steaming"
        ],
        "aliases": [
          "steaming_bowl"
        ]
      },
      {
        "shortcode": "spaghetti",
        "glyph": "🍝",
        "keywords": [
          "food",
          "meatballs",
          "pasta",
          "restaurant"
        ]
      },
      {
        "shortcode": "sweet_potato",
        "glyph": "🍠",
        "keywords": [
          "food",
          "potato",
          "roasted",
          "sweet"
        ]
      },
      {
        "shortcode": "oden",
        "glyph": "🍢",
        "keywords": [
          "food",
          "kebab",
          "restaurant",
          "seafood",
          "skewer",
          "stick"
        ]
      },
      {
        "shortcode": "sushi",
        "glyph": "🍣",
        "keywords": [
          "food"
        ]
      },
      {
        "shortcode": "fried_shrimp",
        "glyph": "🍤",
        "keywords": [
          "fried",
          "prawn",
          "shrimp",
          "tempura"
        ]
      },
      {
        "shortcode": "fish_cake",
        "glyph": "🍥",
        "keywords": [
          "cake",
          "fish",
          "food",
          "pastry",
          "restaurant",
          "swirl"
        ]
      },
      {
        "shortcode": "moon_cake",
        "glyph": "🥮",
        "keywords": [
          "autumn",
          "cake",
          "festival",
          "moon",
          "yuèbǐng"
        ]
      },
      {
        "shortcode": "dango",
        "glyph": "🍡",
        "keywords": [
          "dessert",
          "japanese",
          "skewer",
          "stick",
          "sweet"
        ]
      },
      {
        "shortcode": "dumpling",
        "glyph": "🥟",
        "keywords": [
          "empanada",
          "gyōza",
          "jiaozi",
          "pierogi",
          "potsticker"
        ]
      },
      {
        "shortcode": "fortune_cookie",
        "glyph": "🥠",
        "keywords": [
          "cookie",
          "fortune",
          "prophecy"
        ]
      },
      {
        "shortcode": "takeout_box",
        "glyph": "🥡",
        "keywords": [
          "box",
          "chopsticks",
          "delivery",
          "food",
          "oyster",
          "pail",
          "takeout"
        ]
      },
      {
        "shortcode": "icecream",
        "glyph": "🍦",
        "keywords": [
          "cream",
          "dessert",
          "food",
          "ice",
          "icecream",
          "restaurant",
          "serve",
          "soft",
          "sweet"
        ],
        "aliases": [
          "soft_serve"
        ]
      },
      {
        "shortcode": "shaved_ice",
        "glyph": "🍧",
        "keywords": [
          "dessert",
          "ice",
          "restaurant",
          "shaved",
          "sweet"
        ]
      },
      {
        "shortcode": "ice_cream",
        "glyph": "🍨",
        "keywords": [
          "cream",
          "dessert",
          "food",
          "ice",
          "restaurant",
          "sweet"
        ]
      },
      {
        "shortcode": "doughnut",
        "glyph": "🍩",
        "keywords": [
          "breakfast",
          "dessert",
          "donut",
          "food",
          "sweet"
        ]
      },
      {
        "shortcode": "cookie",
        "glyph": "🍪",
        "keywords": [
          "chip",
          "chocolate",
          "dessert",
          "sweet"
        ]
      },
      {
        "shortcode": "birthday",
        "glyph": "🎂",
        "keywords": [
          "bday",
          "birthday",
          "cake",
          "celebration",
          "dessert",
          "happy",
          "pastry",
          "sweet"
        ],
        "aliases": [
          "birthday_cake"
        ]
      },
      {
        "shortcode": "cake",
        "glyph": "🍰",
        "keywords": [
          "cake",
          "dessert",
          "pastry",
          "slice",
          "sweet"
        ],
        "aliases": [
          "shortcake"
        ]
      },
      {
        "shortcode": "cupcake",
        "glyph": "🧁",
        "keywords": [
          "bakery",
          "dessert",
          "sprinkles",
          "sugar",
          "sweet",
          "treat"
        ]
      },
      {
        "shortcode": "pie",
        "glyph": "🥧",
        "keywords": [
          "apple",
          "filling",
          "fruit",
          "meat",
          "pastry",
          "pumpkin",
          "slice"
        ]
      },
      {
        "shortcode": "chocolate_bar",
        "glyph": "🍫",
        "keywords": [
          "bar",
          "candy",
          "chocolate",
          "dessert",
          "halloween",
          "sweet",
          "tooth"
        ]
      },
      {
        "shortcode": "candy",
        "glyph": "🍬",
        "keywords": [
          "cavities",
          "dessert",
          "halloween",
          "restaurant",
          "sweet",
          "tooth",
          "wrapper"
        ]
      },
      {
        "shortcode": "lollipop",
        "glyph": "🍭",
        "keywords": [
          "candy",
          "dessert",
          "food",
          "restaurant",
          "sweet"
        ]
      },
      {
        "shortcode": "custard",
        "glyph": "🍮",
        "keywords": [
          "dessert",
          "pudding",
          "sweet"
        ]
      },
      {
        "shortcode": "honey_pot",
        "glyph": "🍯",
        "keywords": [
          "barrel",
          "bear",
          "food",
          "honey",
          "honeypot",
          "jar",
          "pot",
          "sweet"
        ]
      },
      {
        "shortcode": "baby_bottle",
        "glyph": "🍼",
        "keywords": [
          "babies",
          "baby",
          "birth",
          "born",
          "bottle",
          "drink",
          "infant",
          "milk",
          "newborn"
        ]
      },
      {
        "shortcode": "milk_glass",
        "glyph": "🥛",
        "keywords": [
          "drink",
          "glass",
          "milk"
        ],
        "aliases": [
          "glass_of_milk",
          "milk"
        ]
      },
      {
        "shortcode": "coffee",
        "glyph": "☕️",
        "keywords": [
          "beverage",
          "cafe",
          "caffeine",
          "chai",
          "coffee",
          "drink",
          "hot",
          "morning",
          "steaming",
          "tea"
        ]
      },
      {
        "shortcode": "teapot",
        "glyph": "🫖",
        "keywords": [
          "brew",
          "drink",
          "food",
          "pot",
          "tea"
        ]
      },
      {
        "shortcode": "tea",
        "glyph": "🍵",
        "keywords": [
          "beverage",
          "cup",
          "drink",
          "handle",
          "oolong",
          "tea",
          "teacup"
        ]
      },
      {
        "shortcode": "sake",
        "glyph": "🍶",
        "keywords": [
          "bar",
          "beverage",
          "bottle",
          "cup",
          "drink",
          "restaurant"
        ]
      },
      {
        "shortcode": "champagne",
        "glyph": "🍾",
        "keywords": [
          "bar",
          "bottle",
          "cork",
          "drink",
          "popping"
        ]
      },
      {
        "shortcode": "wine_glass",
        "glyph": "🍷",
        "keywords": [
          "alcohol",
          "bar",
          "beverage",
          "booze",
          "club",
          "drink",
          "drinking",
          "drinks",
          "glass",
          "restaurant",
          "wine"
        ]
      },
      {
        "shortcode": "cocktail",
        "glyph": "🍸️",
        "keywords": [
          "alcohol",
          "bar",
          "booze",
          "club",
          "cocktail",
          "drink",
          "drinking",
          "drinks",
          "glass",
          "mad",
          "martini",
          "men"
        ]
      },
      {
        "shortcode": "tropical_drink",
        "glyph": "🍹",
        "keywords": [
          "alcohol",
          "bar",
          "booze",
          "club",
          "cocktail",
          "drink",
          "drinking",
          "drinks",
          "drunk",
          "mai",
          "party",
          "tai",
          "tropical",
          "tropics"
        ]
      },
      {
        "shortcode": "beer",
        "glyph": "🍺",
        "keywords": [
          "alcohol",
          "ale",
          "bar",
          "beer",
          "booze",
          "drink",
          "drinking",
          "drinks",
          "mug",
          "octoberfest",
          "oktoberfest",
          "pint",
          "stein",
          "summer"
        ]
      },
      {
        "shortcode": "beers",
        "glyph": "🍻",
        "keywords": [
          "alcohol",
          "bar",
          "beer",
          "booze",
          "bottoms",
          "cheers",
          "clink",
          "clinking",
          "drinking",
          "drinks",
          "mugs"
        ]
      },
      {
        "shortcode": "clinking_glasses",
        "glyph": "🥂",
        "keywords": [
          "celebrate",
          "clink",
          "clinking",
          "drink",
          "glass",
          "glasses"
        ]
      },
      {
        "shortcode": "tumbler_glass",
        "glyph": "🥃",
        "keywords": [
          "glass",
          "liquor",
          "scotch",
          "shot",
          "tumbler",
          "whiskey",
          "whisky"
        ],
        "aliases": [
          "whisky"
        ]
      },
      {
        "shortcode": "pouring_liquid",
        "glyph": "🫗",
        "keywords": [
          "accident",
          "drink",
          "empty",
          "glass",
          "liquid",
          "oops",
          "pour",
          "pouring",
          "spill",
          "water"
        ],
        "aliases": [
          "pour"
        ]
      },
      {
        "shortcode": "cup_with_straw",
        "glyph": "🥤",
        "keywords": [
          "cup",
          "drink",
          "juice",
          "malt",
          "soda",
          "soft",
          "straw",
          "water"
        ]
      },
      {
        "shortcode": "bubble_tea",
        "glyph": "🧋",
        "keywords": [
          "boba",
          "bubble",
          "food",
          "milk",
          "pearl",
          "tea"
        ],
        "aliases": [
          "boba_drink"
        ]
      },
      {
        "shortcode": "beverage_box",
        "glyph": "🧃",
        "keywords": [
          "beverage",
          "box",
          "juice",
          "straw",
          "sweet"
        ],
        "aliases": [
          "juice_box"
        ]
      },
      {
        "shortcode": "mate",
        "glyph": "🧉",
        "keywords": [
          "drink"
        ]
      },
      {
        "shortcode": "ice_cube",
        "glyph": "🧊",
        "keywords": [
          "cold",
          "cube",
          "iceberg"
        ],
        "aliases": [
          "ice"
        ]
      },
      {
        "shortcode": "chopsticks",
        "glyph": "🥢",
        "keywords": [
          "hashi",
          "jeotgarak",
          "kuaizi"
        ]
      },
      {
        "shortcode": "plate_with_cutlery",
        "glyph": "🍽️",
        "keywords": [
          "cooking",
          "dinner",
          "eat",
          "fork",
          "knife",
          "plate"
        ],
        "aliases": [
          "fork_knife_plate"
        ]
      },
      {
        "shortcode": "fork_and_knife",
        "glyph": "🍴",
        "keywords": [
          "breakfast",
          "breaky",
          "cooking",
          "cutlery",
          "delicious",
          "dinner",
          "eat",
          "feed",
          "food",
          "fork",
          "hungry",
          "knife",
          "lunch",
          "restaurant",
          "yum",
          "yummy"
        ]
      },
      {
        "shortcode": "spoon",
        "glyph": "🥄",
        "keywords": [
          "eat",
          "tableware"
        ]
      },
      {
        "shortcode": "hocho",
        "glyph": "🔪",
        "keywords": [
          "chef",
          "cooking",
          "hocho",
          "kitchen",
          "knife",
          "tool",
          "weapon"
        ],
        "aliases": [
          "knife"
        ]
      },
      {
        "shortcode": "jar",
        "glyph": "🫙",
        "keywords": [
          "condiment",
          "container",
          "empty",
          "nothing",
          "sauce",
          "store"
        ]
      },
      {
        "shortcode": "amphora",
        "glyph": "🏺",
        "keywords": [
          "aquarius",
          "cooking",
          "drink",
          "jug",
          "tool",
          "weapon",
          "zodiac"
        ]
      }
    ]
  },
  {
    "id": "travel",
    "icon": "✈️",
    "name": "Travel & Places",
    "entries": [
      {
        "shortcode": "earth_africa",
        "glyph": "🌍️",
        "keywords": [
          "africa",
          "earth",
          "europe",
          "europe-africa",
          "globe",
          "showing",
          "world"
        ],
        "aliases": [
          "earth_europe"
        ]
      },
      {
        "shortcode": "earth_americas",
        "glyph": "🌎️",
        "keywords": [
          "americas",
          "earth",
          "globe",
          "showing",
          "world"
        ]
      },
      {
        "shortcode": "earth_asia",
        "glyph": "🌏️",
        "keywords": [
          "asia",
          "asia-australia",
          "australia",
          "earth",
          "globe",
          "showing",
          "world"
        ]
      },
      {
        "shortcode": "globe_with_meridians",
        "glyph": "🌐",
        "keywords": [
          "earth",
          "globe",
          "internet",
          "meridians",
          "web",
          "world",
          "worldwide"
        ]
      },
      {
        "shortcode": "world_map",
        "glyph": "🗺️",
        "keywords": [
          "map",
          "world"
        ]
      },
      {
        "shortcode": "japan",
        "glyph": "🗾",
        "keywords": [
          "japan",
          "map"
        ],
        "aliases": [
          "japan_map"
        ]
      },
      {
        "shortcode": "compass",
        "glyph": "🧭",
        "keywords": [
          "direction",
          "magnetic",
          "navigation",
          "orienteering"
        ]
      },
      {
        "shortcode": "mountain_snow",
        "glyph": "🏔️",
        "keywords": [
          "cold",
          "mountain",
          "snow",
          "snow-capped"
        ]
      },
      {
        "shortcode": "mountain",
        "glyph": "⛰️",
        "keywords": [
          "mountain"
        ]
      },
      {
        "shortcode": "landslide",
        "glyph": "🛘",
        "keywords": [
          "avalanche",
          "danger",
          "disaster",
          "earthquake",
          "mountain",
          "mudslide",
          "rocks"
        ]
      },
      {
        "shortcode": "volcano",
        "glyph": "🌋",
        "keywords": [
          "eruption",
          "mountain",
          "nature"
        ]
      },
      {
        "shortcode": "mount_fuji",
        "glyph": "🗻",
        "keywords": [
          "fuji",
          "mount",
          "mountain",
          "nature"
        ]
      },
      {
        "shortcode": "camping",
        "glyph": "🏕️",
        "keywords": [
          "camping"
        ]
      },
      {
        "shortcode": "beach_umbrella",
        "glyph": "🏖️",
        "keywords": [
          "beach",
          "umbrella"
        ],
        "aliases": [
          "beach",
          "beach_with_umbrella"
        ]
      },
      {
        "shortcode": "desert",
        "glyph": "🏜️",
        "keywords": [
          "desert"
        ]
      },
      {
        "shortcode": "desert_island",
        "glyph": "🏝️",
        "keywords": [
          "desert",
          "island"
        ],
        "aliases": [
          "island"
        ]
      },
      {
        "shortcode": "national_park",
        "glyph": "🏞️",
        "keywords": [
          "national",
          "park"
        ]
      },
      {
        "shortcode": "stadium",
        "glyph": "🏟️",
        "keywords": [
          "stadium"
        ]
      },
      {
        "shortcode": "classical_building",
        "glyph": "🏛️",
        "keywords": [
          "building",
          "classical"
        ]
      },
      {
        "shortcode": "building_construction",
        "glyph": "🏗️",
        "keywords": [
          "building",
          "construction",
          "crane"
        ],
        "aliases": [
          "construction_site"
        ]
      },
      {
        "shortcode": "bricks",
        "glyph": "🧱",
        "keywords": [
          "bricks",
          "clay",
          "mortar",
          "wall"
        ]
      },
      {
        "shortcode": "rock",
        "glyph": "🪨",
        "keywords": [
          "boulder",
          "heavy",
          "solid",
          "stone",
          "tough"
        ]
      },
      {
        "shortcode": "wood",
        "glyph": "🪵",
        "keywords": [
          "log",
          "lumber",
          "timber"
        ]
      },
      {
        "shortcode": "hut",
        "glyph": "🛖",
        "keywords": [
          "home",
          "house",
          "roundhouse",
          "shelter",
          "yurt"
        ]
      },
      {
        "shortcode": "houses",
        "glyph": "🏘️",
        "keywords": [
          "house"
        ],
        "aliases": [
          "homes"
        ]
      },
      {
        "shortcode": "derelict_house",
        "glyph": "🏚️",
        "keywords": [
          "derelict",
          "home",
          "house"
        ],
        "aliases": [
          "house_abandoned"
        ]
      },
      {
        "shortcode": "house",
        "glyph": "🏠️",
        "keywords": [
          "building",
          "country",
          "heart",
          "home",
          "ranch",
          "settle",
          "simple",
          "suburban",
          "suburbia",
          "where"
        ]
      },
      {
        "shortcode": "house_with_garden",
        "glyph": "🏡",
        "keywords": [
          "building",
          "country",
          "garden",
          "heart",
          "home",
          "house",
          "ranch",
          "settle",
          "simple",
          "suburban",
          "suburbia",
          "where"
        ]
      },
      {
        "shortcode": "office",
        "glyph": "🏢",
        "keywords": [
          "building",
          "city",
          "cubical",
          "job",
          "office"
        ]
      },
      {
        "shortcode": "post_office",
        "glyph": "🏣",
        "keywords": [
          "building",
          "japanese",
          "office",
          "post"
        ]
      },
      {
        "shortcode": "european_post_office",
        "glyph": "🏤",
        "keywords": [
          "building",
          "european",
          "office",
          "post"
        ]
      },
      {
        "shortcode": "hospital",
        "glyph": "🏥",
        "keywords": [
          "building",
          "doctor",
          "medicine"
        ]
      },
      {
        "shortcode": "bank",
        "glyph": "🏦",
        "keywords": [
          "building"
        ]
      },
      {
        "shortcode": "hotel",
        "glyph": "🏨",
        "keywords": [
          "building"
        ]
      },
      {
        "shortcode": "love_hotel",
        "glyph": "🏩",
        "keywords": [
          "building",
          "hotel",
          "love"
        ]
      },
      {
        "shortcode": "convenience_store",
        "glyph": "🏪",
        "keywords": [
          "24",
          "building",
          "convenience",
          "hours",
          "store"
        ]
      },
      {
        "shortcode": "school",
        "glyph": "🏫",
        "keywords": [
          "building"
        ]
      },
      {
        "shortcode": "department_store",
        "glyph": "🏬",
        "keywords": [
          "building",
          "department",
          "store"
        ]
      },
      {
        "shortcode": "factory",
        "glyph": "🏭️",
        "keywords": [
          "building"
        ]
      },
      {
        "shortcode": "japanese_castle",
        "glyph": "🏯",
        "keywords": [
          "building",
          "castle",
          "japanese"
        ]
      },
      {
        "shortcode": "european_castle",
        "glyph": "🏰",
        "keywords": [
          "building",
          "european"
        ],
        "aliases": [
          "castle"
        ]
      },
      {
        "shortcode": "wedding",
        "glyph": "💒",
        "keywords": [
          "chapel",
          "hitched",
          "nuptials",
          "romance"
        ]
      },
      {
        "shortcode": "tokyo_tower",
        "glyph": "🗼",
        "keywords": [
          "tokyo",
          "tower"
        ]
      },
      {
        "shortcode": "statue_of_liberty",
        "glyph": "🗽",
        "keywords": [
          "liberty",
          "new",
          "ny",
          "nyc",
          "statue",
          "york"
        ]
      },
      {
        "shortcode": "church",
        "glyph": "⛪️",
        "keywords": [
          "bless",
          "chapel",
          "christian",
          "cross",
          "religion"
        ]
      },
      {
        "shortcode": "mosque",
        "glyph": "🕌",
        "keywords": [
          "islam",
          "masjid",
          "muslim",
          "religion"
        ]
      },
      {
        "shortcode": "hindu_temple",
        "glyph": "🛕",
        "keywords": [
          "hindu",
          "temple"
        ]
      },
      {
        "shortcode": "synagogue",
        "glyph": "🕍",
        "keywords": [
          "jew",
          "jewish",
          "judaism",
          "religion",
          "temple"
        ]
      },
      {
        "shortcode": "shinto_shrine",
        "glyph": "⛩️",
        "keywords": [
          "religion",
          "shinto",
          "shrine"
        ]
      },
      {
        "shortcode": "kaaba",
        "glyph": "🕋",
        "keywords": [
          "hajj",
          "islam",
          "muslim",
          "religion",
          "umrah"
        ]
      },
      {
        "shortcode": "fountain",
        "glyph": "⛲️",
        "keywords": [
          "fountain"
        ]
      },
      {
        "shortcode": "tent",
        "glyph": "⛺️",
        "keywords": [
          "camping"
        ]
      },
      {
        "shortcode": "foggy",
        "glyph": "🌁",
        "keywords": [
          "fog"
        ]
      },
      {
        "shortcode": "night_with_stars",
        "glyph": "🌃",
        "keywords": [
          "night",
          "star",
          "stars"
        ]
      },
      {
        "shortcode": "cityscape",
        "glyph": "🏙️",
        "keywords": [
          "city"
        ]
      },
      {
        "shortcode": "sunrise_over_mountains",
        "glyph": "🌄",
        "keywords": [
          "morning",
          "mountains",
          "over",
          "sun",
          "sunrise"
        ]
      },
      {
        "shortcode": "sunrise",
        "glyph": "🌅",
        "keywords": [
          "morning",
          "nature",
          "sun"
        ]
      },
      {
        "shortcode": "city_sunset",
        "glyph": "🌆",
        "keywords": [
          "at",
          "building",
          "city",
          "cityscape",
          "dusk",
          "evening",
          "landscape",
          "sun",
          "sunset"
        ],
        "aliases": [
          "city_dusk"
        ]
      },
      {
        "shortcode": "city_sunrise",
        "glyph": "🌇",
        "keywords": [
          "building",
          "dusk",
          "sun"
        ],
        "aliases": [
          "city_sunset"
        ]
      },
      {
        "shortcode": "bridge_at_night",
        "glyph": "🌉",
        "keywords": [
          "at",
          "bridge",
          "night"
        ]
      },
      {
        "shortcode": "hotsprings",
        "glyph": "♨️",
        "keywords": [
          "hot",
          "hotsprings",
          "springs",
          "steaming"
        ]
      },
      {
        "shortcode": "carousel_horse",
        "glyph": "🎠",
        "keywords": [
          "carousel",
          "entertainment",
          "horse"
        ]
      },
      {
        "shortcode": "playground_slide",
        "glyph": "🛝",
        "keywords": [
          "amusement",
          "park",
          "play",
          "playground",
          "playing",
          "slide",
          "sliding",
          "theme"
        ],
        "aliases": [
          "slide"
        ]
      },
      {
        "shortcode": "ferris_wheel",
        "glyph": "🎡",
        "keywords": [
          "amusement",
          "ferris",
          "park",
          "theme",
          "wheel"
        ]
      },
      {
        "shortcode": "roller_coaster",
        "glyph": "🎢",
        "keywords": [
          "amusement",
          "coaster",
          "park",
          "roller",
          "theme"
        ]
      },
      {
        "shortcode": "barber",
        "glyph": "💈",
        "keywords": [
          "barber",
          "cut",
          "fresh",
          "haircut",
          "pole",
          "shave"
        ],
        "aliases": [
          "barber_pole"
        ]
      },
      {
        "shortcode": "circus_tent",
        "glyph": "🎪",
        "keywords": [
          "circus",
          "tent"
        ]
      },
      {
        "shortcode": "steam_locomotive",
        "glyph": "🚂",
        "keywords": [
          "caboose",
          "engine",
          "railway",
          "steam",
          "train",
          "trains",
          "travel"
        ]
      },
      {
        "shortcode": "railway_car",
        "glyph": "🚃",
        "keywords": [
          "car",
          "electric",
          "railway",
          "train",
          "tram",
          "travel",
          "trolleybus"
        ]
      },
      {
        "shortcode": "bullettrain_side",
        "glyph": "🚄",
        "keywords": [
          "high-speed",
          "railway",
          "shinkansen",
          "speed",
          "train"
        ]
      },
      {
        "shortcode": "bullettrain_front",
        "glyph": "🚅",
        "keywords": [
          "bullet",
          "high-speed",
          "nose",
          "railway",
          "shinkansen",
          "speed",
          "train",
          "travel"
        ]
      },
      {
        "shortcode": "train2",
        "glyph": "🚆",
        "keywords": [
          "arrived",
          "choo",
          "railway"
        ],
        "aliases": [
          "train"
        ]
      },
      {
        "shortcode": "metro",
        "glyph": "🚇️",
        "keywords": [
          "subway",
          "travel"
        ]
      },
      {
        "shortcode": "light_rail",
        "glyph": "🚈",
        "keywords": [
          "arrived",
          "light",
          "monorail",
          "rail",
          "railway"
        ]
      },
      {
        "shortcode": "station",
        "glyph": "🚉",
        "keywords": [
          "railway",
          "train"
        ]
      },
      {
        "shortcode": "tram",
        "glyph": "🚊",
        "keywords": [
          "trolleybus"
        ]
      },
      {
        "shortcode": "monorail",
        "glyph": "🚝",
        "keywords": [
          "vehicle"
        ]
      },
      {
        "shortcode": "mountain_railway",
        "glyph": "🚞",
        "keywords": [
          "car",
          "mountain",
          "railway",
          "trip"
        ]
      },
      {
        "shortcode": "train",
        "glyph": "🚋",
        "keywords": [
          "bus",
          "car",
          "tram",
          "trolley",
          "trolleybus"
        ],
        "aliases": [
          "tram_car"
        ]
      },
      {
        "shortcode": "bus",
        "glyph": "🚌",
        "keywords": [
          "school",
          "vehicle"
        ]
      },
      {
        "shortcode": "oncoming_bus",
        "glyph": "🚍️",
        "keywords": [
          "bus",
          "cars",
          "oncoming"
        ]
      },
      {
        "shortcode": "trolleybus",
        "glyph": "🚎",
        "keywords": [
          "bus",
          "tram",
          "trolley"
        ]
      },
      {
        "shortcode": "minibus",
        "glyph": "🚐",
        "keywords": [
          "bus",
          "drive",
          "van",
          "vehicle"
        ]
      },
      {
        "shortcode": "ambulance",
        "glyph": "🚑️",
        "keywords": [
          "emergency",
          "vehicle"
        ]
      },
      {
        "shortcode": "fire_engine",
        "glyph": "🚒",
        "keywords": [
          "engine",
          "fire",
          "truck"
        ]
      },
      {
        "shortcode": "police_car",
        "glyph": "🚓",
        "keywords": [
          "5–0",
          "car",
          "cops",
          "patrol",
          "police"
        ]
      },
      {
        "shortcode": "oncoming_police_car",
        "glyph": "🚔️",
        "keywords": [
          "car",
          "oncoming",
          "police"
        ]
      },
      {
        "shortcode": "taxi",
        "glyph": "🚕",
        "keywords": [
          "cab",
          "cabbie",
          "car",
          "drive",
          "vehicle",
          "yellow"
        ]
      },
      {
        "shortcode": "oncoming_taxi",
        "glyph": "🚖",
        "keywords": [
          "cab",
          "cabbie",
          "cars",
          "drove",
          "hail",
          "oncoming",
          "taxi",
          "yellow"
        ]
      },
      {
        "shortcode": "car",
        "glyph": "🚗",
        "keywords": [
          "car",
          "driving",
          "vehicle"
        ],
        "aliases": [
          "red_car"
        ]
      },
      {
        "shortcode": "oncoming_automobile",
        "glyph": "🚘️",
        "keywords": [
          "automobile",
          "car",
          "cars",
          "drove",
          "oncoming",
          "vehicle"
        ]
      },
      {
        "shortcode": "blue_car",
        "glyph": "🚙",
        "keywords": [
          "car",
          "drive",
          "recreational",
          "sport",
          "sportutility",
          "utility",
          "vehicle"
        ],
        "aliases": [
          "suv"
        ]
      },
      {
        "shortcode": "pickup_truck",
        "glyph": "🛻",
        "keywords": [
          "automobile",
          "car",
          "flatbed",
          "pick-up",
          "pickup",
          "transportation",
          "truck"
        ]
      },
      {
        "shortcode": "truck",
        "glyph": "🚚",
        "keywords": [
          "car",
          "delivery",
          "drive",
          "truck",
          "vehicle"
        ],
        "aliases": [
          "delivery_truck"
        ]
      },
      {
        "shortcode": "articulated_lorry",
        "glyph": "🚛",
        "keywords": [
          "articulated",
          "car",
          "drive",
          "lorry",
          "move",
          "semi",
          "truck",
          "vehicle"
        ]
      },
      {
        "shortcode": "tractor",
        "glyph": "🚜",
        "keywords": [
          "vehicle"
        ]
      },
      {
        "shortcode": "racing_car",
        "glyph": "🏎️",
        "keywords": [
          "car",
          "racing",
          "zoom"
        ]
      },
      {
        "shortcode": "motorcycle",
        "glyph": "🏍️",
        "keywords": [
          "racing"
        ]
      },
      {
        "shortcode": "motor_scooter",
        "glyph": "🛵",
        "keywords": [
          "motor",
          "scooter"
        ]
      },
      {
        "shortcode": "manual_wheelchair",
        "glyph": "🦽",
        "keywords": [
          "accessibility",
          "manual",
          "wheelchair"
        ]
      },
      {
        "shortcode": "motorized_wheelchair",
        "glyph": "🦼",
        "keywords": [
          "accessibility",
          "motorized",
          "wheelchair"
        ]
      },
      {
        "shortcode": "auto_rickshaw",
        "glyph": "🛺",
        "keywords": [
          "auto",
          "rickshaw",
          "tuk"
        ]
      },
      {
        "shortcode": "bike",
        "glyph": "🚲️",
        "keywords": [
          "bike",
          "class",
          "cycle",
          "cycling",
          "cyclist",
          "gang",
          "ride",
          "spin",
          "spinning"
        ],
        "aliases": [
          "bicycle"
        ]
      },
      {
        "shortcode": "kick_scooter",
        "glyph": "🛴",
        "keywords": [
          "kick",
          "scooter"
        ],
        "aliases": [
          "scooter"
        ]
      },
      {
        "shortcode": "skateboard",
        "glyph": "🛹",
        "keywords": [
          "board",
          "skate",
          "skater",
          "wheels"
        ]
      },
      {
        "shortcode": "roller_skate",
        "glyph": "🛼",
        "keywords": [
          "blades",
          "roller",
          "skate",
          "skates",
          "sport"
        ]
      },
      {
        "shortcode": "busstop",
        "glyph": "🚏",
        "keywords": [
          "bus",
          "busstop",
          "stop"
        ]
      },
      {
        "shortcode": "motorway",
        "glyph": "🛣️",
        "keywords": [
          "highway",
          "road"
        ]
      },
      {
        "shortcode": "railway_track",
        "glyph": "🛤️",
        "keywords": [
          "railway",
          "track",
          "train"
        ]
      },
      {
        "shortcode": "oil_drum",
        "glyph": "🛢️",
        "keywords": [
          "drum",
          "oil"
        ]
      },
      {
        "shortcode": "fuelpump",
        "glyph": "⛽️",
        "keywords": [
          "diesel",
          "fuel",
          "fuelpump",
          "gas",
          "gasoline",
          "pump",
          "station"
        ]
      },
      {
        "shortcode": "wheel",
        "glyph": "🛞",
        "keywords": [
          "car",
          "circle",
          "tire",
          "turn",
          "vehicle"
        ]
      },
      {
        "shortcode": "rotating_light",
        "glyph": "🚨",
        "keywords": [
          "alarm",
          "alert",
          "beacon",
          "car",
          "emergency",
          "light",
          "police",
          "revolving",
          "siren"
        ]
      },
      {
        "shortcode": "traffic_light",
        "glyph": "🚥",
        "keywords": [
          "horizontal",
          "intersection",
          "light",
          "signal",
          "stop",
          "stoplight",
          "traffic"
        ]
      },
      {
        "shortcode": "vertical_traffic_light",
        "glyph": "🚦",
        "keywords": [
          "drove",
          "intersection",
          "light",
          "signal",
          "stop",
          "stoplight",
          "traffic",
          "vertical"
        ]
      },
      {
        "shortcode": "stop_sign",
        "glyph": "🛑",
        "keywords": [
          "octagonal",
          "sign",
          "stop"
        ],
        "aliases": [
          "octagonal_sign"
        ]
      },
      {
        "shortcode": "construction",
        "glyph": "🚧",
        "keywords": [
          "barrier"
        ]
      },
      {
        "shortcode": "anchor",
        "glyph": "⚓️",
        "keywords": [
          "ship",
          "tool"
        ]
      },
      {
        "shortcode": "ring_buoy",
        "glyph": "🛟",
        "keywords": [
          "buoy",
          "float",
          "life",
          "lifesaver",
          "preserver",
          "rescue",
          "ring",
          "safety",
          "save",
          "saver",
          "swim"
        ],
        "aliases": [
          "lifebuoy"
        ]
      },
      {
        "shortcode": "boat",
        "glyph": "⛵️",
        "keywords": [
          "boat",
          "resort",
          "sailing",
          "sea",
          "yacht"
        ],
        "aliases": [
          "sailboat"
        ]
      },
      {
        "shortcode": "canoe",
        "glyph": "🛶",
        "keywords": [
          "boat"
        ]
      },
      {
        "shortcode": "speedboat",
        "glyph": "🚤",
        "keywords": [
          "billionaire",
          "boat",
          "lake",
          "luxury",
          "millionaire",
          "summer",
          "travel"
        ]
      },
      {
        "shortcode": "passenger_ship",
        "glyph": "🛳️",
        "keywords": [
          "passenger",
          "ship"
        ],
        "aliases": [
          "cruise_ship"
        ]
      },
      {
        "shortcode": "ferry",
        "glyph": "⛴️",
        "keywords": [
          "boat",
          "passenger"
        ]
      },
      {
        "shortcode": "motor_boat",
        "glyph": "🛥️",
        "keywords": [
          "boat",
          "motor",
          "motorboat"
        ],
        "aliases": [
          "motorboat"
        ]
      },
      {
        "shortcode": "ship",
        "glyph": "🚢",
        "keywords": [
          "boat",
          "passenger",
          "travel"
        ]
      },
      {
        "shortcode": "airplane",
        "glyph": "✈️",
        "keywords": [
          "aeroplane",
          "fly",
          "flying",
          "jet",
          "plane",
          "travel"
        ]
      },
      {
        "shortcode": "small_airplane",
        "glyph": "🛩️",
        "keywords": [
          "aeroplane",
          "airplane",
          "plane",
          "small"
        ]
      },
      {
        "shortcode": "flight_departure",
        "glyph": "🛫",
        "keywords": [
          "aeroplane",
          "airplane",
          "check-in",
          "departure",
          "departures",
          "plane"
        ],
        "aliases": [
          "airplane_departure"
        ]
      },
      {
        "shortcode": "flight_arrival",
        "glyph": "🛬",
        "keywords": [
          "aeroplane",
          "airplane",
          "arrival",
          "arrivals",
          "arriving",
          "landing",
          "plane"
        ],
        "aliases": [
          "airplane_arriving"
        ]
      },
      {
        "shortcode": "parachute",
        "glyph": "🪂",
        "keywords": [
          "hang-glide",
          "parasail",
          "skydive"
        ]
      },
      {
        "shortcode": "seat",
        "glyph": "💺",
        "keywords": [
          "chair"
        ]
      },
      {
        "shortcode": "helicopter",
        "glyph": "🚁",
        "keywords": [
          "copter",
          "roflcopter",
          "travel",
          "vehicle"
        ]
      },
      {
        "shortcode": "suspension_railway",
        "glyph": "🚟",
        "keywords": [
          "railway",
          "suspension"
        ]
      },
      {
        "shortcode": "mountain_cableway",
        "glyph": "🚠",
        "keywords": [
          "cable",
          "cableway",
          "gondola",
          "lift",
          "mountain",
          "ski"
        ]
      },
      {
        "shortcode": "aerial_tramway",
        "glyph": "🚡",
        "keywords": [
          "aerial",
          "cable",
          "car",
          "gondola",
          "ropeway",
          "tramway"
        ]
      },
      {
        "shortcode": "artificial_satellite",
        "glyph": "🛰️",
        "keywords": [
          "space"
        ],
        "aliases": [
          "satellite"
        ]
      },
      {
        "shortcode": "rocket",
        "glyph": "🚀",
        "keywords": [
          "launch",
          "rockets",
          "space",
          "travel"
        ]
      },
      {
        "shortcode": "flying_saucer",
        "glyph": "🛸",
        "keywords": [
          "aliens",
          "extra",
          "flying",
          "saucer",
          "terrestrial",
          "ufo"
        ]
      },
      {
        "shortcode": "bellhop_bell",
        "glyph": "🛎️",
        "keywords": [
          "bell",
          "bellhop",
          "hotel"
        ],
        "aliases": [
          "bellhop"
        ]
      },
      {
        "shortcode": "luggage",
        "glyph": "🧳",
        "keywords": [
          "bag",
          "packing",
          "roller",
          "suitcase",
          "travel"
        ]
      },
      {
        "shortcode": "hourglass",
        "glyph": "⌛️",
        "keywords": [
          "done",
          "hourglass",
          "sand",
          "time",
          "timer"
        ]
      },
      {
        "shortcode": "hourglass_flowing_sand",
        "glyph": "⏳️",
        "keywords": [
          "done",
          "flowing",
          "hourglass",
          "hours",
          "not",
          "sand",
          "timer",
          "waiting",
          "yolo"
        ]
      },
      {
        "shortcode": "watch",
        "glyph": "⌚️",
        "keywords": [
          "clock",
          "time"
        ]
      },
      {
        "shortcode": "alarm_clock",
        "glyph": "⏰️",
        "keywords": [
          "alarm",
          "clock",
          "hours",
          "hrs",
          "late",
          "time",
          "waiting"
        ]
      },
      {
        "shortcode": "stopwatch",
        "glyph": "⏱️",
        "keywords": [
          "clock",
          "time"
        ]
      },
      {
        "shortcode": "timer_clock",
        "glyph": "⏲️",
        "keywords": [
          "clock",
          "timer"
        ]
      },
      {
        "shortcode": "mantelpiece_clock",
        "glyph": "🕰️",
        "keywords": [
          "clock",
          "mantelpiece",
          "time"
        ],
        "aliases": [
          "clock"
        ]
      },
      {
        "shortcode": "clock12",
        "glyph": "🕛️",
        "keywords": [
          "12",
          "12:00",
          "clock",
          "o’clock",
          "time",
          "twelve"
        ]
      },
      {
        "shortcode": "clock1230",
        "glyph": "🕧️",
        "keywords": [
          "12",
          "12:30",
          "30",
          "clock",
          "thirty",
          "time",
          "twelve"
        ]
      },
      {
        "shortcode": "clock1",
        "glyph": "🕐️",
        "keywords": [
          "1",
          "1:00",
          "clock",
          "one",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock130",
        "glyph": "🕜️",
        "keywords": [
          "1",
          "1:30",
          "30",
          "clock",
          "one",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock2",
        "glyph": "🕑️",
        "keywords": [
          "2",
          "2:00",
          "clock",
          "o’clock",
          "time",
          "two"
        ]
      },
      {
        "shortcode": "clock230",
        "glyph": "🕝️",
        "keywords": [
          "2",
          "2:30",
          "30",
          "clock",
          "thirty",
          "time",
          "two"
        ]
      },
      {
        "shortcode": "clock3",
        "glyph": "🕒️",
        "keywords": [
          "3",
          "3:00",
          "clock",
          "o’clock",
          "three",
          "time"
        ]
      },
      {
        "shortcode": "clock330",
        "glyph": "🕞️",
        "keywords": [
          "3",
          "30",
          "3:30",
          "clock",
          "thirty",
          "three",
          "time"
        ]
      },
      {
        "shortcode": "clock4",
        "glyph": "🕓️",
        "keywords": [
          "4",
          "4:00",
          "clock",
          "four",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock430",
        "glyph": "🕟️",
        "keywords": [
          "30",
          "4",
          "4:30",
          "clock",
          "four",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock5",
        "glyph": "🕔️",
        "keywords": [
          "5",
          "5:00",
          "clock",
          "five",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock530",
        "glyph": "🕠️",
        "keywords": [
          "30",
          "5",
          "5:30",
          "clock",
          "five",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock6",
        "glyph": "🕕️",
        "keywords": [
          "6",
          "6:00",
          "clock",
          "o’clock",
          "six",
          "time"
        ]
      },
      {
        "shortcode": "clock630",
        "glyph": "🕡️",
        "keywords": [
          "30",
          "6",
          "6:30",
          "clock",
          "six",
          "thirty"
        ]
      },
      {
        "shortcode": "clock7",
        "glyph": "🕖️",
        "keywords": [
          "0",
          "7",
          "7:00",
          "clock",
          "o’clock",
          "seven"
        ]
      },
      {
        "shortcode": "clock730",
        "glyph": "🕢️",
        "keywords": [
          "30",
          "7",
          "7:30",
          "clock",
          "seven",
          "thirty"
        ]
      },
      {
        "shortcode": "clock8",
        "glyph": "🕗️",
        "keywords": [
          "8",
          "8:00",
          "clock",
          "eight",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock830",
        "glyph": "🕣️",
        "keywords": [
          "30",
          "8",
          "8:30",
          "clock",
          "eight",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock9",
        "glyph": "🕘️",
        "keywords": [
          "9",
          "9:00",
          "clock",
          "nine",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock930",
        "glyph": "🕤️",
        "keywords": [
          "30",
          "9",
          "9:30",
          "clock",
          "nine",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock10",
        "glyph": "🕙️",
        "keywords": [
          "0",
          "10",
          "10:00",
          "clock",
          "o’clock",
          "ten"
        ]
      },
      {
        "shortcode": "clock1030",
        "glyph": "🕥️",
        "keywords": [
          "10",
          "10:30",
          "30",
          "clock",
          "ten",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "clock11",
        "glyph": "🕚️",
        "keywords": [
          "11",
          "11:00",
          "clock",
          "eleven",
          "o’clock",
          "time"
        ]
      },
      {
        "shortcode": "clock1130",
        "glyph": "🕦️",
        "keywords": [
          "11",
          "11:30",
          "30",
          "clock",
          "eleven",
          "thirty",
          "time"
        ]
      },
      {
        "shortcode": "new_moon",
        "glyph": "🌑",
        "keywords": [
          "dark",
          "moon",
          "new",
          "space"
        ]
      },
      {
        "shortcode": "waxing_crescent_moon",
        "glyph": "🌒",
        "keywords": [
          "crescent",
          "dreams",
          "moon",
          "space",
          "waxing"
        ]
      },
      {
        "shortcode": "first_quarter_moon",
        "glyph": "🌓",
        "keywords": [
          "first",
          "moon",
          "quarter",
          "space"
        ]
      },
      {
        "shortcode": "moon",
        "glyph": "🌔",
        "keywords": [
          "gibbous",
          "moon",
          "space",
          "waxing"
        ],
        "aliases": [
          "waxing_gibbous_moon"
        ]
      },
      {
        "shortcode": "full_moon",
        "glyph": "🌕️",
        "keywords": [
          "full",
          "moon",
          "space"
        ]
      },
      {
        "shortcode": "waning_gibbous_moon",
        "glyph": "🌖",
        "keywords": [
          "gibbous",
          "moon",
          "space",
          "waning"
        ]
      },
      {
        "shortcode": "last_quarter_moon",
        "glyph": "🌗",
        "keywords": [
          "last",
          "moon",
          "quarter",
          "space"
        ]
      },
      {
        "shortcode": "waning_crescent_moon",
        "glyph": "🌘",
        "keywords": [
          "crescent",
          "moon",
          "space",
          "waning"
        ]
      },
      {
        "shortcode": "crescent_moon",
        "glyph": "🌙",
        "keywords": [
          "crescent",
          "moon",
          "ramadan",
          "space"
        ]
      },
      {
        "shortcode": "new_moon_with_face",
        "glyph": "🌚",
        "keywords": [
          "face",
          "moon",
          "new",
          "space"
        ]
      },
      {
        "shortcode": "first_quarter_moon_with_face",
        "glyph": "🌛",
        "keywords": [
          "face",
          "first",
          "moon",
          "quarter",
          "space"
        ]
      },
      {
        "shortcode": "last_quarter_moon_with_face",
        "glyph": "🌜️",
        "keywords": [
          "dreams",
          "face",
          "last",
          "moon",
          "quarter"
        ]
      },
      {
        "shortcode": "thermometer",
        "glyph": "🌡️",
        "keywords": [
          "weather"
        ]
      },
      {
        "shortcode": "sunny",
        "glyph": "☀️",
        "keywords": [
          "bright",
          "rays",
          "space",
          "sunny",
          "weather"
        ],
        "aliases": [
          "sun"
        ]
      },
      {
        "shortcode": "full_moon_with_face",
        "glyph": "🌝",
        "keywords": [
          "bright",
          "face",
          "full",
          "moon"
        ]
      },
      {
        "shortcode": "sun_with_face",
        "glyph": "🌞",
        "keywords": [
          "beach",
          "bright",
          "day",
          "face",
          "heat",
          "shine",
          "sun",
          "sunny",
          "sunshine",
          "weather"
        ]
      },
      {
        "shortcode": "ringed_planet",
        "glyph": "🪐",
        "keywords": [
          "planet",
          "ringed",
          "saturn",
          "saturnine"
        ],
        "aliases": [
          "saturn"
        ]
      },
      {
        "shortcode": "star",
        "glyph": "⭐️",
        "keywords": [
          "astronomy",
          "medium",
          "stars",
          "white"
        ]
      },
      {
        "shortcode": "star2",
        "glyph": "🌟",
        "keywords": [
          "glittery",
          "glow",
          "glowing",
          "night",
          "shining",
          "sparkle",
          "star",
          "win"
        ],
        "aliases": [
          "glowing_star"
        ]
      },
      {
        "shortcode": "stars",
        "glyph": "🌠",
        "keywords": [
          "falling",
          "night",
          "shooting",
          "space",
          "star"
        ],
        "aliases": [
          "shooting_star"
        ]
      },
      {
        "shortcode": "milky_way",
        "glyph": "🌌",
        "keywords": [
          "milky",
          "space",
          "way"
        ]
      },
      {
        "shortcode": "cloud",
        "glyph": "☁️",
        "keywords": [
          "weather"
        ]
      },
      {
        "shortcode": "partly_sunny",
        "glyph": "⛅️",
        "keywords": [
          "behind",
          "cloud",
          "cloudy",
          "sun",
          "weather"
        ],
        "aliases": [
          "sun_behind_cloud"
        ]
      },
      {
        "shortcode": "cloud_with_lightning_and_rain",
        "glyph": "⛈️",
        "keywords": [
          "cloud",
          "lightning",
          "rain",
          "thunder",
          "thunderstorm"
        ],
        "aliases": [
          "stormy",
          "thunder_cloud_and_rain"
        ]
      },
      {
        "shortcode": "sun_behind_small_cloud",
        "glyph": "🌤️",
        "keywords": [
          "behind",
          "cloud",
          "sun",
          "weather"
        ],
        "aliases": [
          "sunny"
        ]
      },
      {
        "shortcode": "sun_behind_large_cloud",
        "glyph": "🌥️",
        "keywords": [
          "behind",
          "cloud",
          "sun",
          "weather"
        ],
        "aliases": [
          "cloudy"
        ]
      },
      {
        "shortcode": "sun_behind_rain_cloud",
        "glyph": "🌦️",
        "keywords": [
          "behind",
          "cloud",
          "rain",
          "sun",
          "weather"
        ],
        "aliases": [
          "sun_and_rain"
        ]
      },
      {
        "shortcode": "cloud_with_rain",
        "glyph": "🌧️",
        "keywords": [
          "cloud",
          "rain",
          "weather"
        ],
        "aliases": [
          "rainy"
        ]
      },
      {
        "shortcode": "cloud_with_snow",
        "glyph": "🌨️",
        "keywords": [
          "cloud",
          "cold",
          "snow",
          "weather"
        ],
        "aliases": [
          "snowy"
        ]
      },
      {
        "shortcode": "cloud_with_lightning",
        "glyph": "🌩️",
        "keywords": [
          "cloud",
          "lightning",
          "weather"
        ],
        "aliases": [
          "lightning"
        ]
      },
      {
        "shortcode": "tornado",
        "glyph": "🌪️",
        "keywords": [
          "cloud",
          "weather",
          "whirlwind"
        ]
      },
      {
        "shortcode": "fog",
        "glyph": "🌫️",
        "keywords": [
          "cloud",
          "weather"
        ]
      },
      {
        "shortcode": "wind_face",
        "glyph": "🌬️",
        "keywords": [
          "blow",
          "cloud",
          "face",
          "wind"
        ],
        "aliases": [
          "wind_blowing_face"
        ]
      },
      {
        "shortcode": "cyclone",
        "glyph": "🌀",
        "keywords": [
          "dizzy",
          "hurricane",
          "twister",
          "typhoon",
          "weather"
        ]
      },
      {
        "shortcode": "rainbow",
        "glyph": "🌈",
        "keywords": [
          "gay",
          "genderqueer",
          "glbt",
          "glbtq",
          "lesbian",
          "lgbt",
          "lgbtq",
          "lgbtqia",
          "nature",
          "pride",
          "queer",
          "rain",
          "trans",
          "transgender",
          "weather"
        ]
      },
      {
        "shortcode": "closed_umbrella",
        "glyph": "🌂",
        "keywords": [
          "closed",
          "clothing",
          "rain",
          "umbrella"
        ]
      },
      {
        "shortcode": "open_umbrella",
        "glyph": "☂️",
        "keywords": [
          "clothing",
          "rain"
        ],
        "aliases": [
          "umbrella"
        ]
      },
      {
        "shortcode": "umbrella",
        "glyph": "☔️",
        "keywords": [
          "clothing",
          "drop",
          "drops",
          "rain",
          "umbrella",
          "weather"
        ],
        "aliases": [
          "umbrella_with_rain"
        ]
      },
      {
        "shortcode": "parasol_on_ground",
        "glyph": "⛱️",
        "keywords": [
          "ground",
          "rain",
          "sun",
          "umbrella"
        ],
        "aliases": [
          "beach_umbrella",
          "umbrella_on_ground"
        ]
      },
      {
        "shortcode": "zap",
        "glyph": "⚡️",
        "keywords": [
          "danger",
          "electric",
          "electricity",
          "high",
          "lightning",
          "nature",
          "thunder",
          "thunderbolt",
          "voltage",
          "zap"
        ],
        "aliases": [
          "high_voltage"
        ]
      },
      {
        "shortcode": "snowflake",
        "glyph": "❄️",
        "keywords": [
          "cold",
          "snow",
          "weather"
        ]
      },
      {
        "shortcode": "snowman_with_snow",
        "glyph": "☃️",
        "keywords": [
          "cold",
          "man",
          "snow"
        ],
        "aliases": [
          "snowman2"
        ]
      },
      {
        "shortcode": "snowman",
        "glyph": "⛄️",
        "keywords": [
          "cold",
          "man",
          "snow",
          "snowman"
        ]
      },
      {
        "shortcode": "comet",
        "glyph": "☄️",
        "keywords": [
          "space"
        ]
      },
      {
        "shortcode": "fire",
        "glyph": "🔥",
        "keywords": [
          "af",
          "burn",
          "flame",
          "hot",
          "lit",
          "litaf",
          "tool"
        ]
      },
      {
        "shortcode": "droplet",
        "glyph": "💧",
        "keywords": [
          "cold",
          "comic",
          "drop",
          "nature",
          "sad",
          "sweat",
          "tear",
          "water",
          "weather"
        ]
      },
      {
        "shortcode": "ocean",
        "glyph": "🌊",
        "keywords": [
          "nature",
          "ocean",
          "surf",
          "surfer",
          "surfing",
          "water",
          "wave"
        ],
        "aliases": [
          "water_wave"
        ]
      }
    ]
  },
  {
    "id": "activities",
    "icon": "⚽",
    "name": "Activities",
    "entries": [
      {
        "shortcode": "jack_o_lantern",
        "glyph": "🎃",
        "keywords": [
          "celebration",
          "halloween",
          "jack",
          "lantern",
          "pumpkin"
        ]
      },
      {
        "shortcode": "christmas_tree",
        "glyph": "🎄",
        "keywords": [
          "celebration",
          "christmas",
          "tree"
        ]
      },
      {
        "shortcode": "fireworks",
        "glyph": "🎆",
        "keywords": [
          "boom",
          "celebration",
          "entertainment",
          "yolo"
        ]
      },
      {
        "shortcode": "sparkler",
        "glyph": "🎇",
        "keywords": [
          "boom",
          "celebration",
          "fireworks",
          "sparkle"
        ]
      },
      {
        "shortcode": "firecracker",
        "glyph": "🧨",
        "keywords": [
          "dynamite",
          "explosive",
          "fire",
          "fireworks",
          "light",
          "pop",
          "popping",
          "spark"
        ]
      },
      {
        "shortcode": "sparkles",
        "glyph": "✨️",
        "keywords": [
          "*",
          "magic",
          "sparkle",
          "star"
        ]
      },
      {
        "shortcode": "balloon",
        "glyph": "🎈",
        "keywords": [
          "birthday",
          "celebrate",
          "celebration"
        ]
      },
      {
        "shortcode": "tada",
        "glyph": "🎉",
        "keywords": [
          "awesome",
          "birthday",
          "celebrate",
          "celebration",
          "excited",
          "hooray",
          "party",
          "popper",
          "tada",
          "woohoo"
        ],
        "aliases": [
          "party",
          "party_popper"
        ]
      },
      {
        "shortcode": "confetti_ball",
        "glyph": "🎊",
        "keywords": [
          "ball",
          "celebrate",
          "celebration",
          "confetti",
          "party",
          "woohoo"
        ]
      },
      {
        "shortcode": "tanabata_tree",
        "glyph": "🎋",
        "keywords": [
          "banner",
          "celebration",
          "japanese",
          "tanabata",
          "tree"
        ]
      },
      {
        "shortcode": "bamboo",
        "glyph": "🎍",
        "keywords": [
          "bamboo",
          "celebration",
          "decoration",
          "japanese",
          "pine",
          "plant"
        ]
      },
      {
        "shortcode": "dolls",
        "glyph": "🎎",
        "keywords": [
          "celebration",
          "doll",
          "dolls",
          "festival",
          "japanese"
        ]
      },
      {
        "shortcode": "flags",
        "glyph": "🎏",
        "keywords": [
          "carp",
          "celebration",
          "streamer"
        ],
        "aliases": [
          "carp_streamer"
        ]
      },
      {
        "shortcode": "wind_chime",
        "glyph": "🎐",
        "keywords": [
          "bell",
          "celebration",
          "chime",
          "wind"
        ]
      },
      {
        "shortcode": "rice_scene",
        "glyph": "🎑",
        "keywords": [
          "celebration",
          "ceremony",
          "moon",
          "viewing"
        ],
        "aliases": [
          "moon_ceremony"
        ]
      },
      {
        "shortcode": "red_envelope",
        "glyph": "🧧",
        "keywords": [
          "envelope",
          "gift",
          "good",
          "hóngbāo",
          "lai",
          "luck",
          "money",
          "red",
          "see"
        ]
      },
      {
        "shortcode": "ribbon",
        "glyph": "🎀",
        "keywords": [
          "celebration"
        ]
      },
      {
        "shortcode": "gift",
        "glyph": "🎁",
        "keywords": [
          "birthday",
          "bow",
          "box",
          "celebration",
          "christmas",
          "gift",
          "present",
          "surprise",
          "wrapped"
        ]
      },
      {
        "shortcode": "reminder_ribbon",
        "glyph": "🎗️",
        "keywords": [
          "celebration",
          "reminder",
          "ribbon"
        ]
      },
      {
        "shortcode": "tickets",
        "glyph": "🎟️",
        "keywords": [
          "admission",
          "ticket",
          "tickets"
        ],
        "aliases": [
          "admission_tickets"
        ]
      },
      {
        "shortcode": "ticket",
        "glyph": "🎫",
        "keywords": [
          "admission",
          "stub"
        ]
      },
      {
        "shortcode": "medal_military",
        "glyph": "🎖️",
        "keywords": [
          "award",
          "celebration",
          "medal",
          "military"
        ],
        "aliases": [
          "military_medal"
        ]
      },
      {
        "shortcode": "trophy",
        "glyph": "🏆️",
        "keywords": [
          "champion",
          "champs",
          "prize",
          "slay",
          "sport",
          "victory",
          "win",
          "winning"
        ]
      },
      {
        "shortcode": "medal_sports",
        "glyph": "🏅",
        "keywords": [
          "award",
          "gold",
          "medal",
          "sports",
          "winner"
        ],
        "aliases": [
          "sports_medal"
        ]
      },
      {
        "shortcode": "1st_place_medal",
        "glyph": "🥇",
        "keywords": [
          "1st",
          "first",
          "gold",
          "medal",
          "place"
        ],
        "aliases": [
          "1st",
          "first_place_medal"
        ]
      },
      {
        "shortcode": "2nd_place_medal",
        "glyph": "🥈",
        "keywords": [
          "2nd",
          "medal",
          "place",
          "second",
          "silver"
        ],
        "aliases": [
          "2nd",
          "second_place_medal"
        ]
      },
      {
        "shortcode": "3rd_place_medal",
        "glyph": "🥉",
        "keywords": [
          "3rd",
          "bronze",
          "medal",
          "place",
          "third"
        ],
        "aliases": [
          "3rd",
          "third_place_medal"
        ]
      },
      {
        "shortcode": "soccer",
        "glyph": "⚽️",
        "keywords": [
          "ball",
          "football",
          "futbol",
          "soccer",
          "sport"
        ]
      },
      {
        "shortcode": "baseball",
        "glyph": "⚾️",
        "keywords": [
          "ball",
          "sport"
        ]
      },
      {
        "shortcode": "softball",
        "glyph": "🥎",
        "keywords": [
          "ball",
          "glove",
          "sports",
          "underarm"
        ]
      },
      {
        "shortcode": "basketball",
        "glyph": "🏀",
        "keywords": [
          "ball",
          "hoop",
          "sport"
        ]
      },
      {
        "shortcode": "volleyball",
        "glyph": "🏐",
        "keywords": [
          "ball",
          "game"
        ]
      },
      {
        "shortcode": "football",
        "glyph": "🏈",
        "keywords": [
          "american",
          "ball",
          "bowl",
          "football",
          "sport",
          "super"
        ]
      },
      {
        "shortcode": "rugby_football",
        "glyph": "🏉",
        "keywords": [
          "ball",
          "football",
          "rugby",
          "sport"
        ]
      },
      {
        "shortcode": "tennis",
        "glyph": "🎾",
        "keywords": [
          "ball",
          "racquet",
          "sport"
        ]
      },
      {
        "shortcode": "flying_disc",
        "glyph": "🥏",
        "keywords": [
          "disc",
          "flying",
          "ultimate"
        ]
      },
      {
        "shortcode": "bowling",
        "glyph": "🎳",
        "keywords": [
          "ball",
          "game",
          "sport",
          "strike"
        ]
      },
      {
        "shortcode": "cricket_game",
        "glyph": "🏏",
        "keywords": [
          "ball",
          "bat",
          "cricket",
          "game"
        ]
      },
      {
        "shortcode": "field_hockey",
        "glyph": "🏑",
        "keywords": [
          "ball",
          "field",
          "game",
          "hockey",
          "stick"
        ]
      },
      {
        "shortcode": "ice_hockey",
        "glyph": "🏒",
        "keywords": [
          "game",
          "hockey",
          "ice",
          "puck",
          "stick"
        ],
        "aliases": [
          "hockey"
        ]
      },
      {
        "shortcode": "lacrosse",
        "glyph": "🥍",
        "keywords": [
          "ball",
          "goal",
          "sports",
          "stick"
        ]
      },
      {
        "shortcode": "ping_pong",
        "glyph": "🏓",
        "keywords": [
          "ball",
          "bat",
          "game",
          "paddle",
          "ping",
          "pingpong",
          "pong",
          "table",
          "tennis"
        ]
      },
      {
        "shortcode": "badminton",
        "glyph": "🏸",
        "keywords": [
          "birdie",
          "game",
          "racquet",
          "shuttlecock"
        ]
      },
      {
        "shortcode": "boxing_glove",
        "glyph": "🥊",
        "keywords": [
          "boxing",
          "glove"
        ]
      },
      {
        "shortcode": "martial_arts_uniform",
        "glyph": "🥋",
        "keywords": [
          "arts",
          "judo",
          "karate",
          "martial",
          "taekwondo",
          "uniform"
        ]
      },
      {
        "shortcode": "goal_net",
        "glyph": "🥅",
        "keywords": [
          "goal",
          "net"
        ]
      },
      {
        "shortcode": "golf",
        "glyph": "⛳️",
        "keywords": [
          "flag",
          "golf",
          "hole",
          "sport"
        ]
      },
      {
        "shortcode": "ice_skate",
        "glyph": "⛸️",
        "keywords": [
          "ice",
          "skate",
          "skating"
        ]
      },
      {
        "shortcode": "fishing_pole_and_fish",
        "glyph": "🎣",
        "keywords": [
          "entertainment",
          "fish",
          "fishing",
          "pole",
          "sport"
        ],
        "aliases": [
          "fishing_pole"
        ]
      },
      {
        "shortcode": "diving_mask",
        "glyph": "🤿",
        "keywords": [
          "diving",
          "mask",
          "scuba",
          "snorkeling"
        ]
      },
      {
        "shortcode": "running_shirt_with_sash",
        "glyph": "🎽",
        "keywords": [
          "athletics",
          "running",
          "sash",
          "shirt"
        ],
        "aliases": [
          "running_shirt"
        ]
      },
      {
        "shortcode": "ski",
        "glyph": "🎿",
        "keywords": [
          "ski",
          "snow",
          "sport"
        ]
      },
      {
        "shortcode": "sled",
        "glyph": "🛷",
        "keywords": [
          "luge",
          "sledge",
          "sleigh",
          "snow",
          "toboggan"
        ]
      },
      {
        "shortcode": "curling_stone",
        "glyph": "🥌",
        "keywords": [
          "curling",
          "game",
          "rock",
          "stone"
        ]
      },
      {
        "shortcode": "dart",
        "glyph": "🎯",
        "keywords": [
          "bull",
          "dart",
          "direct",
          "entertainment",
          "game",
          "hit",
          "target"
        ],
        "aliases": [
          "bullseye",
          "direct_hit"
        ]
      },
      {
        "shortcode": "yo_yo",
        "glyph": "🪀",
        "keywords": [
          "fluctuate",
          "toy"
        ]
      },
      {
        "shortcode": "kite",
        "glyph": "🪁",
        "keywords": [
          "fly",
          "soar"
        ]
      },
      {
        "shortcode": "gun",
        "glyph": "🔫",
        "keywords": [
          "gun",
          "handgun",
          "pistol",
          "revolver",
          "tool",
          "water",
          "weapon"
        ],
        "aliases": [
          "pistol"
        ]
      },
      {
        "shortcode": "8ball",
        "glyph": "🎱",
        "keywords": [
          "8",
          "8ball",
          "ball",
          "billiard",
          "eight",
          "game",
          "pool"
        ],
        "aliases": [
          "billiards"
        ]
      },
      {
        "shortcode": "crystal_ball",
        "glyph": "🔮",
        "keywords": [
          "ball",
          "crystal",
          "fairy",
          "fairytale",
          "fantasy",
          "fortune",
          "future",
          "magic",
          "tale",
          "tool"
        ]
      },
      {
        "shortcode": "magic_wand",
        "glyph": "🪄",
        "keywords": [
          "magic",
          "magician",
          "wand",
          "witch",
          "wizard"
        ]
      },
      {
        "shortcode": "video_game",
        "glyph": "🎮️",
        "keywords": [
          "controller",
          "entertainment",
          "game",
          "video"
        ],
        "aliases": [
          "controller"
        ]
      },
      {
        "shortcode": "joystick",
        "glyph": "🕹️",
        "keywords": [
          "game",
          "video",
          "videogame"
        ]
      },
      {
        "shortcode": "slot_machine",
        "glyph": "🎰",
        "keywords": [
          "casino",
          "gamble",
          "gambling",
          "game",
          "machine",
          "slot",
          "slots"
        ]
      },
      {
        "shortcode": "game_die",
        "glyph": "🎲",
        "keywords": [
          "dice",
          "die",
          "entertainment",
          "game"
        ]
      },
      {
        "shortcode": "jigsaw",
        "glyph": "🧩",
        "keywords": [
          "clue",
          "interlocking",
          "jigsaw",
          "piece",
          "puzzle"
        ],
        "aliases": [
          "puzzle_piece"
        ]
      },
      {
        "shortcode": "teddy_bear",
        "glyph": "🧸",
        "keywords": [
          "bear",
          "plaything",
          "plush",
          "stuffed",
          "teddy",
          "toy"
        ]
      },
      {
        "shortcode": "pinata",
        "glyph": "🪅",
        "keywords": [
          "candy",
          "celebrate",
          "celebration",
          "cinco",
          "de",
          "festive",
          "mayo",
          "party",
          "pinada",
          "pinata"
        ]
      },
      {
        "shortcode": "mirror_ball",
        "glyph": "🪩",
        "keywords": [
          "ball",
          "dance",
          "disco",
          "glitter",
          "mirror",
          "party"
        ],
        "aliases": [
          "disco",
          "disco_ball"
        ]
      },
      {
        "shortcode": "nesting_dolls",
        "glyph": "🪆",
        "keywords": [
          "babooshka",
          "baboushka",
          "babushka",
          "doll",
          "dolls",
          "matryoshka",
          "nesting",
          "russia"
        ]
      },
      {
        "shortcode": "spades",
        "glyph": "♠️",
        "keywords": [
          "card",
          "game",
          "spade",
          "suit"
        ]
      },
      {
        "shortcode": "hearts",
        "glyph": "♥️",
        "keywords": [
          "card",
          "emotion",
          "game",
          "heart",
          "hearts",
          "suit"
        ]
      },
      {
        "shortcode": "diamonds",
        "glyph": "♦️",
        "keywords": [
          "card",
          "diamond",
          "game",
          "suit"
        ]
      },
      {
        "shortcode": "clubs",
        "glyph": "♣️",
        "keywords": [
          "card",
          "club",
          "clubs",
          "game",
          "suit"
        ]
      },
      {
        "shortcode": "chess_pawn",
        "glyph": "♟️",
        "keywords": [
          "chess",
          "dupe",
          "expendable",
          "pawn"
        ]
      },
      {
        "shortcode": "black_joker",
        "glyph": "🃏",
        "keywords": [
          "card",
          "game",
          "wildcard"
        ]
      },
      {
        "shortcode": "mahjong",
        "glyph": "🀄️",
        "keywords": [
          "dragon",
          "game",
          "mahjong",
          "red"
        ]
      },
      {
        "shortcode": "flower_playing_cards",
        "glyph": "🎴",
        "keywords": [
          "card",
          "cards",
          "flower",
          "game",
          "japanese",
          "playing"
        ]
      },
      {
        "shortcode": "performing_arts",
        "glyph": "🎭️",
        "keywords": [
          "actor",
          "actress",
          "art",
          "arts",
          "entertainment",
          "mask",
          "performing",
          "theater",
          "theatre",
          "thespian"
        ]
      },
      {
        "shortcode": "framed_picture",
        "glyph": "🖼️",
        "keywords": [
          "art",
          "frame",
          "framed",
          "museum",
          "painting",
          "picture"
        ],
        "aliases": [
          "frame_with_picture"
        ]
      },
      {
        "shortcode": "art",
        "glyph": "🎨",
        "keywords": [
          "art",
          "artist",
          "artsy",
          "arty",
          "colorful",
          "creative",
          "entertainment",
          "museum",
          "painter",
          "painting",
          "palette"
        ],
        "aliases": [
          "palette"
        ]
      },
      {
        "shortcode": "thread",
        "glyph": "🧵",
        "keywords": [
          "needle",
          "sewing",
          "spool",
          "string"
        ]
      },
      {
        "shortcode": "sewing_needle",
        "glyph": "🪡",
        "keywords": [
          "embroidery",
          "needle",
          "sew",
          "sewing",
          "stitches",
          "sutures",
          "tailoring",
          "thread"
        ]
      },
      {
        "shortcode": "yarn",
        "glyph": "🧶",
        "keywords": [
          "ball",
          "crochet",
          "knit"
        ]
      },
      {
        "shortcode": "knot",
        "glyph": "🪢",
        "keywords": [
          "cord",
          "rope",
          "tangled",
          "tie",
          "twine",
          "twist"
        ]
      }
    ]
  },
  {
    "id": "objects",
    "icon": "💡",
    "name": "Objects",
    "entries": [
      {
        "shortcode": "eyeglasses",
        "glyph": "👓️",
        "keywords": [
          "clothing",
          "eye",
          "eyeglasses",
          "eyewear"
        ],
        "aliases": [
          "glasses"
        ]
      },
      {
        "shortcode": "dark_sunglasses",
        "glyph": "🕶️",
        "keywords": [
          "dark",
          "eye",
          "eyewear",
          "glasses"
        ],
        "aliases": [
          "sunglasses"
        ]
      },
      {
        "shortcode": "goggles",
        "glyph": "🥽",
        "keywords": [
          "dive",
          "eye",
          "protection",
          "scuba",
          "swimming",
          "welding"
        ]
      },
      {
        "shortcode": "lab_coat",
        "glyph": "🥼",
        "keywords": [
          "clothes",
          "coat",
          "doctor",
          "dr",
          "experiment",
          "jacket",
          "lab",
          "scientist",
          "white"
        ]
      },
      {
        "shortcode": "safety_vest",
        "glyph": "🦺",
        "keywords": [
          "emergency",
          "safety",
          "vest"
        ]
      },
      {
        "shortcode": "necktie",
        "glyph": "👔",
        "keywords": [
          "clothing",
          "employed",
          "serious",
          "shirt",
          "tie"
        ]
      },
      {
        "shortcode": "shirt",
        "glyph": "👕",
        "keywords": [
          "blue",
          "casual",
          "clothes",
          "clothing",
          "collar",
          "dressed",
          "shirt",
          "shopping",
          "tshirt",
          "weekend"
        ],
        "aliases": [
          "tshirt"
        ]
      },
      {
        "shortcode": "jeans",
        "glyph": "👖",
        "keywords": [
          "blue",
          "casual",
          "clothes",
          "clothing",
          "denim",
          "dressed",
          "pants",
          "shopping",
          "trousers",
          "weekend"
        ]
      },
      {
        "shortcode": "scarf",
        "glyph": "🧣",
        "keywords": [
          "bundle",
          "cold",
          "neck",
          "up"
        ]
      },
      {
        "shortcode": "gloves",
        "glyph": "🧤",
        "keywords": [
          "hand"
        ]
      },
      {
        "shortcode": "coat",
        "glyph": "🧥",
        "keywords": [
          "brr",
          "bundle",
          "cold",
          "jacket",
          "up"
        ]
      },
      {
        "shortcode": "socks",
        "glyph": "🧦",
        "keywords": [
          "stocking"
        ]
      },
      {
        "shortcode": "dress",
        "glyph": "👗",
        "keywords": [
          "clothes",
          "clothing",
          "dressed",
          "fancy",
          "shopping"
        ]
      },
      {
        "shortcode": "kimono",
        "glyph": "👘",
        "keywords": [
          "clothing",
          "comfortable"
        ]
      },
      {
        "shortcode": "sari",
        "glyph": "🥻",
        "keywords": [
          "clothing",
          "dress"
        ]
      },
      {
        "shortcode": "one_piece_swimsuit",
        "glyph": "🩱",
        "keywords": [
          "bathing",
          "one-piece",
          "suit",
          "swimsuit"
        ]
      },
      {
        "shortcode": "swim_brief",
        "glyph": "🩲",
        "keywords": [
          "bathing",
          "one-piece",
          "suit",
          "swimsuit",
          "underwear"
        ],
        "aliases": [
          "briefs"
        ]
      },
      {
        "shortcode": "shorts",
        "glyph": "🩳",
        "keywords": [
          "bathing",
          "pants",
          "suit",
          "swimsuit",
          "underwear"
        ]
      },
      {
        "shortcode": "bikini",
        "glyph": "👙",
        "keywords": [
          "bathing",
          "beach",
          "clothing",
          "pool",
          "suit",
          "swim"
        ]
      },
      {
        "shortcode": "womans_clothes",
        "glyph": "👚",
        "keywords": [
          "blouse",
          "clothes",
          "clothing",
          "collar",
          "dress",
          "dressed",
          "lady",
          "shirt",
          "shopping",
          "woman",
          "woman’s"
        ]
      },
      {
        "shortcode": "folding_hand_fan",
        "glyph": "🪭",
        "keywords": [
          "clack",
          "clap",
          "cool",
          "cooling",
          "dance",
          "fan",
          "flirt",
          "flutter",
          "folding",
          "hand",
          "hot",
          "shy"
        ],
        "aliases": [
          "folding_fan"
        ]
      },
      {
        "shortcode": "purse",
        "glyph": "👛",
        "keywords": [
          "clothes",
          "clothing",
          "coin",
          "dress",
          "fancy",
          "handbag",
          "shopping"
        ]
      },
      {
        "shortcode": "handbag",
        "glyph": "👜",
        "keywords": [
          "bag",
          "clothes",
          "clothing",
          "dress",
          "lady",
          "purse",
          "shopping"
        ]
      },
      {
        "shortcode": "pouch",
        "glyph": "👝",
        "keywords": [
          "bag",
          "clothes",
          "clothing",
          "clutch",
          "dress",
          "handbag",
          "pouch",
          "purse"
        ],
        "aliases": [
          "clutch_bag"
        ]
      },
      {
        "shortcode": "shopping",
        "glyph": "🛍️",
        "keywords": [
          "bag",
          "bags",
          "hotel",
          "shopping"
        ],
        "aliases": [
          "shopping_bags"
        ]
      },
      {
        "shortcode": "school_satchel",
        "glyph": "🎒",
        "keywords": [
          "backpacking",
          "bag",
          "bookbag",
          "education",
          "rucksack",
          "satchel",
          "school"
        ],
        "aliases": [
          "backpack"
        ]
      },
      {
        "shortcode": "thong_sandal",
        "glyph": "🩴",
        "keywords": [
          "beach",
          "flip",
          "flop",
          "sandal",
          "sandals",
          "shoe",
          "thong",
          "thongs",
          "zōri"
        ]
      },
      {
        "shortcode": "mans_shoe",
        "glyph": "👞",
        "keywords": [
          "brown",
          "clothes",
          "clothing",
          "feet",
          "foot",
          "kick",
          "man",
          "man’s",
          "shoe",
          "shoes",
          "shopping"
        ],
        "aliases": [
          "shoe"
        ]
      },
      {
        "shortcode": "athletic_shoe",
        "glyph": "👟",
        "keywords": [
          "athletic",
          "clothes",
          "clothing",
          "fast",
          "kick",
          "running",
          "shoe",
          "shoes",
          "shopping",
          "sneaker",
          "tennis"
        ],
        "aliases": [
          "sneaker"
        ]
      },
      {
        "shortcode": "hiking_boot",
        "glyph": "🥾",
        "keywords": [
          "backpacking",
          "boot",
          "brown",
          "camping",
          "hiking",
          "outdoors",
          "shoe"
        ]
      },
      {
        "shortcode": "flat_shoe",
        "glyph": "🥿",
        "keywords": [
          "ballet",
          "comfy",
          "flat",
          "flats",
          "shoe",
          "slip-on",
          "slipper"
        ],
        "aliases": [
          "womans_flat_shoe"
        ]
      },
      {
        "shortcode": "high_heel",
        "glyph": "👠",
        "keywords": [
          "clothes",
          "clothing",
          "dress",
          "fashion",
          "heel",
          "heels",
          "high-heeled",
          "shoe",
          "shoes",
          "shopping",
          "stiletto",
          "woman"
        ]
      },
      {
        "shortcode": "sandal",
        "glyph": "👡",
        "keywords": [
          "clothing",
          "sandal",
          "shoe",
          "woman",
          "woman’s"
        ]
      },
      {
        "shortcode": "ballet_shoes",
        "glyph": "🩰",
        "keywords": [
          "ballet",
          "dance",
          "shoes"
        ]
      },
      {
        "shortcode": "boot",
        "glyph": "👢",
        "keywords": [
          "boot",
          "clothes",
          "clothing",
          "dress",
          "shoe",
          "shoes",
          "shopping",
          "woman",
          "woman’s"
        ]
      },
      {
        "shortcode": "hair_pick",
        "glyph": "🪮",
        "keywords": [
          "afro",
          "comb",
          "groom",
          "hair",
          "pick"
        ]
      },
      {
        "shortcode": "crown",
        "glyph": "👑",
        "keywords": [
          "clothing",
          "family",
          "king",
          "medieval",
          "queen",
          "royal",
          "royalty",
          "win"
        ]
      },
      {
        "shortcode": "womans_hat",
        "glyph": "👒",
        "keywords": [
          "clothes",
          "clothing",
          "garden",
          "hat",
          "hats",
          "party",
          "woman",
          "woman’s"
        ]
      },
      {
        "shortcode": "tophat",
        "glyph": "🎩",
        "keywords": [
          "clothes",
          "clothing",
          "fancy",
          "formal",
          "hat",
          "magic",
          "top",
          "tophat"
        ],
        "aliases": [
          "top_hat"
        ]
      },
      {
        "shortcode": "mortar_board",
        "glyph": "🎓️",
        "keywords": [
          "cap",
          "celebration",
          "clothing",
          "education",
          "graduation",
          "hat",
          "scholar"
        ],
        "aliases": [
          "graduation_cap"
        ]
      },
      {
        "shortcode": "billed_cap",
        "glyph": "🧢",
        "keywords": [
          "baseball",
          "bent",
          "billed",
          "cap",
          "dad",
          "hat"
        ]
      },
      {
        "shortcode": "military_helmet",
        "glyph": "🪖",
        "keywords": [
          "army",
          "helmet",
          "military",
          "soldier",
          "war",
          "warrior"
        ]
      },
      {
        "shortcode": "rescue_worker_helmet",
        "glyph": "⛑️",
        "keywords": [
          "aid",
          "cross",
          "face",
          "hat",
          "helmet",
          "rescue",
          "worker’s"
        ],
        "aliases": [
          "helmet_with_cross"
        ]
      },
      {
        "shortcode": "prayer_beads",
        "glyph": "📿",
        "keywords": [
          "beads",
          "clothing",
          "necklace",
          "prayer",
          "religion"
        ]
      },
      {
        "shortcode": "lipstick",
        "glyph": "💄",
        "keywords": [
          "cosmetics",
          "date",
          "makeup"
        ]
      },
      {
        "shortcode": "ring",
        "glyph": "💍",
        "keywords": [
          "diamond",
          "engaged",
          "engagement",
          "married",
          "romance",
          "shiny",
          "sparkling",
          "wedding"
        ]
      },
      {
        "shortcode": "gem",
        "glyph": "💎",
        "keywords": [
          "diamond",
          "engagement",
          "gem",
          "jewel",
          "money",
          "romance",
          "stone",
          "wedding"
        ]
      },
      {
        "shortcode": "mute",
        "glyph": "🔇",
        "keywords": [
          "mute",
          "muted",
          "quiet",
          "silent",
          "sound",
          "speaker"
        ],
        "aliases": [
          "no_sound"
        ]
      },
      {
        "shortcode": "speaker",
        "glyph": "🔈️",
        "keywords": [
          "low",
          "soft",
          "sound",
          "speaker",
          "volume"
        ],
        "aliases": [
          "low_volume",
          "quiet_sound"
        ]
      },
      {
        "shortcode": "sound",
        "glyph": "🔉",
        "keywords": [
          "medium",
          "sound",
          "speaker",
          "volume"
        ],
        "aliases": [
          "medium_volumne"
        ]
      },
      {
        "shortcode": "loud_sound",
        "glyph": "🔊",
        "keywords": [
          "high",
          "loud",
          "music",
          "sound",
          "speaker",
          "volume"
        ],
        "aliases": [
          "high_volume"
        ]
      },
      {
        "shortcode": "loudspeaker",
        "glyph": "📢",
        "keywords": [
          "address",
          "communication",
          "loud",
          "public",
          "sound"
        ]
      },
      {
        "shortcode": "mega",
        "glyph": "📣",
        "keywords": [
          "cheering",
          "sound"
        ],
        "aliases": [
          "megaphone"
        ]
      },
      {
        "shortcode": "postal_horn",
        "glyph": "📯",
        "keywords": [
          "horn",
          "post",
          "postal"
        ]
      },
      {
        "shortcode": "bell",
        "glyph": "🔔",
        "keywords": [
          "break",
          "church",
          "sound"
        ]
      },
      {
        "shortcode": "no_bell",
        "glyph": "🔕",
        "keywords": [
          "bell",
          "forbidden",
          "mute",
          "no",
          "not",
          "prohibited",
          "quiet",
          "silent",
          "slash",
          "sound"
        ]
      },
      {
        "shortcode": "musical_score",
        "glyph": "🎼",
        "keywords": [
          "music",
          "musical",
          "note",
          "score"
        ]
      },
      {
        "shortcode": "musical_note",
        "glyph": "🎵",
        "keywords": [
          "music",
          "musical",
          "note",
          "sound"
        ]
      },
      {
        "shortcode": "notes",
        "glyph": "🎶",
        "keywords": [
          "music",
          "musical",
          "note",
          "notes",
          "sound"
        ],
        "aliases": [
          "musical_notes"
        ]
      },
      {
        "shortcode": "studio_microphone",
        "glyph": "🎙️",
        "keywords": [
          "mic",
          "microphone",
          "music",
          "studio"
        ]
      },
      {
        "shortcode": "level_slider",
        "glyph": "🎚️",
        "keywords": [
          "level",
          "music",
          "slider"
        ]
      },
      {
        "shortcode": "control_knobs",
        "glyph": "🎛️",
        "keywords": [
          "control",
          "knobs",
          "music"
        ]
      },
      {
        "shortcode": "microphone",
        "glyph": "🎤",
        "keywords": [
          "karaoke",
          "mic",
          "music",
          "sing",
          "sound"
        ]
      },
      {
        "shortcode": "headphones",
        "glyph": "🎧️",
        "keywords": [
          "earbud",
          "sound"
        ]
      },
      {
        "shortcode": "radio",
        "glyph": "📻️",
        "keywords": [
          "entertainment",
          "tbt",
          "video"
        ]
      },
      {
        "shortcode": "saxophone",
        "glyph": "🎷",
        "keywords": [
          "instrument",
          "music",
          "sax"
        ]
      },
      {
        "shortcode": "trumpet",
        "glyph": "🎺",
        "keywords": [
          "instrument",
          "music"
        ]
      },
      {
        "shortcode": "trombone",
        "glyph": "🪊",
        "keywords": [
          "brass",
          "instrument",
          "jazz",
          "music",
          "sad",
          "slide"
        ]
      },
      {
        "shortcode": "accordion",
        "glyph": "🪗",
        "keywords": [
          "box",
          "concertina",
          "instrument",
          "music",
          "squeeze",
          "squeezebox"
        ]
      },
      {
        "shortcode": "guitar",
        "glyph": "🎸",
        "keywords": [
          "instrument",
          "music",
          "strat"
        ]
      },
      {
        "shortcode": "musical_keyboard",
        "glyph": "🎹",
        "keywords": [
          "instrument",
          "keyboard",
          "music",
          "musical",
          "piano"
        ]
      },
      {
        "shortcode": "violin",
        "glyph": "🎻",
        "keywords": [
          "instrument",
          "music"
        ]
      },
      {
        "shortcode": "banjo",
        "glyph": "🪕",
        "keywords": [
          "music",
          "stringed"
        ]
      },
      {
        "shortcode": "drum",
        "glyph": "🥁",
        "keywords": [
          "drumsticks",
          "music"
        ]
      },
      {
        "shortcode": "long_drum",
        "glyph": "🪘",
        "keywords": [
          "beat",
          "conga",
          "drum",
          "instrument",
          "long",
          "rhythm"
        ]
      },
      {
        "shortcode": "maracas",
        "glyph": "🪇",
        "keywords": [
          "cha",
          "dance",
          "instrument",
          "music",
          "party",
          "percussion",
          "rattle",
          "shake",
          "shaker"
        ]
      },
      {
        "shortcode": "flute",
        "glyph": "🪈",
        "keywords": [
          "band",
          "fife",
          "flautist",
          "instrument",
          "marching",
          "music",
          "orchestra",
          "piccolo",
          "pipe",
          "recorder",
          "woodwind"
        ]
      },
      {
        "shortcode": "harp",
        "glyph": "🪉",
        "keywords": [
          "cupid",
          "instrument",
          "love",
          "music",
          "orchestra"
        ]
      },
      {
        "shortcode": "iphone",
        "glyph": "📱",
        "keywords": [
          "cell",
          "communication",
          "mobile",
          "phone",
          "telephone"
        ],
        "aliases": [
          "android",
          "mobile_phone"
        ]
      },
      {
        "shortcode": "calling",
        "glyph": "📲",
        "keywords": [
          "arrow",
          "build",
          "call",
          "cell",
          "communication",
          "mobile",
          "phone",
          "receive",
          "telephone"
        ],
        "aliases": [
          "mobile_phone_arrow"
        ]
      },
      {
        "shortcode": "phone",
        "glyph": "☎️",
        "keywords": [
          "phone"
        ],
        "aliases": [
          "telephone"
        ]
      },
      {
        "shortcode": "telephone_receiver",
        "glyph": "📞",
        "keywords": [
          "communication",
          "phone",
          "receiver",
          "telephone",
          "voip"
        ]
      },
      {
        "shortcode": "pager",
        "glyph": "📟️",
        "keywords": [
          "communication"
        ]
      },
      {
        "shortcode": "fax",
        "glyph": "📠",
        "keywords": [
          "communication",
          "fax",
          "machine"
        ],
        "aliases": [
          "fax_machine"
        ]
      },
      {
        "shortcode": "battery",
        "glyph": "🔋",
        "keywords": [
          "battery"
        ]
      },
      {
        "shortcode": "low_battery",
        "glyph": "🪫",
        "keywords": [
          "battery",
          "drained",
          "electronic",
          "energy",
          "low",
          "power"
        ]
      },
      {
        "shortcode": "electric_plug",
        "glyph": "🔌",
        "keywords": [
          "electric",
          "electricity",
          "plug"
        ]
      },
      {
        "shortcode": "computer",
        "glyph": "💻️",
        "keywords": [
          "computer",
          "office",
          "pc",
          "personal"
        ],
        "aliases": [
          "laptop"
        ]
      },
      {
        "shortcode": "desktop_computer",
        "glyph": "🖥️",
        "keywords": [
          "computer",
          "desktop",
          "monitor"
        ],
        "aliases": [
          "computer"
        ]
      },
      {
        "shortcode": "printer",
        "glyph": "🖨️",
        "keywords": [
          "computer"
        ]
      },
      {
        "shortcode": "keyboard",
        "glyph": "⌨️",
        "keywords": [
          "computer"
        ]
      },
      {
        "shortcode": "computer_mouse",
        "glyph": "🖱️",
        "keywords": [
          "computer",
          "mouse"
        ]
      },
      {
        "shortcode": "trackball",
        "glyph": "🖲️",
        "keywords": [
          "computer"
        ]
      },
      {
        "shortcode": "minidisc",
        "glyph": "💽",
        "keywords": [
          "computer",
          "disk",
          "minidisk",
          "optical"
        ],
        "aliases": [
          "computer_disk"
        ]
      },
      {
        "shortcode": "floppy_disk",
        "glyph": "💾",
        "keywords": [
          "computer",
          "disk",
          "floppy"
        ]
      },
      {
        "shortcode": "cd",
        "glyph": "💿️",
        "keywords": [
          "blu-ray",
          "cd",
          "computer",
          "disk",
          "dvd",
          "optical"
        ],
        "aliases": [
          "optical_disk"
        ]
      },
      {
        "shortcode": "dvd",
        "glyph": "📀",
        "keywords": [
          "blu-ray",
          "cd",
          "computer",
          "disk",
          "optical"
        ]
      },
      {
        "shortcode": "abacus",
        "glyph": "🧮",
        "keywords": [
          "calculation",
          "calculator"
        ]
      },
      {
        "shortcode": "movie_camera",
        "glyph": "🎥",
        "keywords": [
          "bollywood",
          "camera",
          "cinema",
          "film",
          "hollywood",
          "movie",
          "record"
        ]
      },
      {
        "shortcode": "film_strip",
        "glyph": "🎞️",
        "keywords": [
          "cinema",
          "film",
          "frames",
          "movie"
        ],
        "aliases": [
          "film_frames"
        ]
      },
      {
        "shortcode": "film_projector",
        "glyph": "📽️",
        "keywords": [
          "cinema",
          "film",
          "movie",
          "projector",
          "video"
        ]
      },
      {
        "shortcode": "clapper",
        "glyph": "🎬️",
        "keywords": [
          "action",
          "board",
          "clapper",
          "movie"
        ]
      },
      {
        "shortcode": "tv",
        "glyph": "📺️",
        "keywords": [
          "tv",
          "video"
        ]
      },
      {
        "shortcode": "camera",
        "glyph": "📷️",
        "keywords": [
          "photo",
          "selfie",
          "snap",
          "tbt",
          "trip",
          "video"
        ]
      },
      {
        "shortcode": "camera_flash",
        "glyph": "📸",
        "keywords": [
          "camera",
          "flash",
          "video"
        ],
        "aliases": [
          "camera_with_flash"
        ]
      },
      {
        "shortcode": "video_camera",
        "glyph": "📹️",
        "keywords": [
          "camcorder",
          "camera",
          "tbt",
          "video"
        ]
      },
      {
        "shortcode": "vhs",
        "glyph": "📼",
        "keywords": [
          "old",
          "school",
          "tape",
          "vcr",
          "vhs",
          "video"
        ],
        "aliases": [
          "videocassette"
        ]
      },
      {
        "shortcode": "mag",
        "glyph": "🔍️",
        "keywords": [
          "glass",
          "lab",
          "left",
          "left-pointing",
          "magnifying",
          "science",
          "search",
          "tilted",
          "tool"
        ]
      },
      {
        "shortcode": "mag_right",
        "glyph": "🔎",
        "keywords": [
          "contact",
          "glass",
          "lab",
          "magnifying",
          "right",
          "right-pointing",
          "science",
          "search",
          "tilted",
          "tool"
        ]
      },
      {
        "shortcode": "candle",
        "glyph": "🕯️",
        "keywords": [
          "light"
        ]
      },
      {
        "shortcode": "bulb",
        "glyph": "💡",
        "keywords": [
          "bulb",
          "comic",
          "electric",
          "idea",
          "light"
        ],
        "aliases": [
          "light_bulb"
        ]
      },
      {
        "shortcode": "flashlight",
        "glyph": "🔦",
        "keywords": [
          "electric",
          "light",
          "tool",
          "torch"
        ]
      },
      {
        "shortcode": "izakaya_lantern",
        "glyph": "🏮",
        "keywords": [
          "bar",
          "lantern",
          "light",
          "paper",
          "red",
          "restaurant"
        ],
        "aliases": [
          "lantern",
          "red_paper_lantern"
        ]
      },
      {
        "shortcode": "diya_lamp",
        "glyph": "🪔",
        "keywords": [
          "diya",
          "lamp",
          "light",
          "oil"
        ]
      },
      {
        "shortcode": "notebook_with_decorative_cover",
        "glyph": "📔",
        "keywords": [
          "book",
          "cover",
          "decorated",
          "decorative",
          "education",
          "notebook",
          "school",
          "writing"
        ]
      },
      {
        "shortcode": "closed_book",
        "glyph": "📕",
        "keywords": [
          "book",
          "closed",
          "education"
        ]
      },
      {
        "shortcode": "book",
        "glyph": "📖",
        "keywords": [
          "book",
          "education",
          "fantasy",
          "knowledge",
          "library",
          "novels",
          "open",
          "reading"
        ],
        "aliases": [
          "open_book"
        ]
      },
      {
        "shortcode": "green_book",
        "glyph": "📗",
        "keywords": [
          "book",
          "education",
          "fantasy",
          "green",
          "library",
          "reading"
        ]
      },
      {
        "shortcode": "blue_book",
        "glyph": "📘",
        "keywords": [
          "blue",
          "book",
          "education",
          "fantasy",
          "library",
          "reading"
        ]
      },
      {
        "shortcode": "orange_book",
        "glyph": "📙",
        "keywords": [
          "book",
          "education",
          "fantasy",
          "library",
          "orange",
          "reading"
        ]
      },
      {
        "shortcode": "books",
        "glyph": "📚️",
        "keywords": [
          "book",
          "education",
          "fantasy",
          "knowledge",
          "library",
          "novels",
          "reading",
          "school",
          "study"
        ]
      },
      {
        "shortcode": "notebook",
        "glyph": "📓",
        "keywords": [
          "notebook"
        ]
      },
      {
        "shortcode": "ledger",
        "glyph": "📒",
        "keywords": [
          "notebook"
        ]
      },
      {
        "shortcode": "page_with_curl",
        "glyph": "📃",
        "keywords": [
          "curl",
          "document",
          "page",
          "paper"
        ]
      },
      {
        "shortcode": "scroll",
        "glyph": "📜",
        "keywords": [
          "paper"
        ]
      },
      {
        "shortcode": "page_facing_up",
        "glyph": "📄",
        "keywords": [
          "document",
          "facing",
          "page",
          "paper",
          "up"
        ]
      },
      {
        "shortcode": "newspaper",
        "glyph": "📰",
        "keywords": [
          "communication",
          "news",
          "paper"
        ]
      },
      {
        "shortcode": "newspaper_roll",
        "glyph": "🗞️",
        "keywords": [
          "news",
          "newspaper",
          "paper",
          "rolled",
          "rolled-up"
        ],
        "aliases": [
          "rolled_up_newspaper"
        ]
      },
      {
        "shortcode": "bookmark_tabs",
        "glyph": "📑",
        "keywords": [
          "bookmark",
          "mark",
          "marker",
          "tabs"
        ]
      },
      {
        "shortcode": "bookmark",
        "glyph": "🔖",
        "keywords": [
          "mark"
        ]
      },
      {
        "shortcode": "label",
        "glyph": "🏷️",
        "keywords": [
          "tag"
        ]
      },
      {
        "shortcode": "coin",
        "glyph": "🪙",
        "keywords": [
          "dollar",
          "euro",
          "gold",
          "metal",
          "money",
          "rich",
          "silver",
          "treasure"
        ]
      },
      {
        "shortcode": "moneybag",
        "glyph": "💰️",
        "keywords": [
          "bag",
          "bank",
          "bet",
          "billion",
          "cash",
          "cost",
          "dollar",
          "gold",
          "million",
          "money",
          "moneybag",
          "paid",
          "paying",
          "pot",
          "rich",
          "win"
        ]
      },
      {
        "shortcode": "treasure_chest",
        "glyph": "🪎",
        "keywords": [
          "gem",
          "gold",
          "jewels",
          "loot",
          "money",
          "prize",
          "silver",
          "valuables",
          "wealth"
        ]
      },
      {
        "shortcode": "yen",
        "glyph": "💴",
        "keywords": [
          "bank",
          "banknote",
          "bill",
          "currency",
          "money",
          "note",
          "yen"
        ]
      },
      {
        "shortcode": "dollar",
        "glyph": "💵",
        "keywords": [
          "bank",
          "banknote",
          "bill",
          "currency",
          "dollar",
          "money",
          "note"
        ]
      },
      {
        "shortcode": "euro",
        "glyph": "💶",
        "keywords": [
          "100",
          "bank",
          "banknote",
          "bill",
          "currency",
          "euro",
          "money",
          "note",
          "rich"
        ]
      },
      {
        "shortcode": "pound",
        "glyph": "💷",
        "keywords": [
          "bank",
          "banknote",
          "bill",
          "billion",
          "cash",
          "currency",
          "money",
          "note",
          "pound",
          "pounds"
        ]
      },
      {
        "shortcode": "money_with_wings",
        "glyph": "💸",
        "keywords": [
          "bank",
          "banknote",
          "bill",
          "billion",
          "cash",
          "dollar",
          "fly",
          "million",
          "money",
          "note",
          "pay",
          "wings"
        ]
      },
      {
        "shortcode": "credit_card",
        "glyph": "💳️",
        "keywords": [
          "bank",
          "card",
          "cash",
          "charge",
          "credit",
          "money",
          "pay"
        ]
      },
      {
        "shortcode": "receipt",
        "glyph": "🧾",
        "keywords": [
          "accounting",
          "bookkeeping",
          "evidence",
          "invoice",
          "proof"
        ]
      },
      {
        "shortcode": "chart",
        "glyph": "💹",
        "keywords": [
          "bank",
          "chart",
          "currency",
          "graph",
          "growth",
          "increasing",
          "market",
          "money",
          "rise",
          "trend",
          "upward",
          "yen"
        ]
      },
      {
        "shortcode": "envelope",
        "glyph": "✉️",
        "keywords": [
          "e-mail",
          "email",
          "letter"
        ]
      },
      {
        "shortcode": "e-mail",
        "glyph": "📧",
        "keywords": [
          "email",
          "letter",
          "mail"
        ],
        "aliases": [
          "email"
        ]
      },
      {
        "shortcode": "incoming_envelope",
        "glyph": "📨",
        "keywords": [
          "delivering",
          "e-mail",
          "email",
          "envelope",
          "incoming",
          "letter",
          "mail",
          "receive",
          "sent"
        ]
      },
      {
        "shortcode": "envelope_with_arrow",
        "glyph": "📩",
        "keywords": [
          "arrow",
          "communication",
          "down",
          "e-mail",
          "email",
          "envelope",
          "letter",
          "mail",
          "outgoing",
          "send",
          "sent"
        ]
      },
      {
        "shortcode": "outbox_tray",
        "glyph": "📤️",
        "keywords": [
          "box",
          "email",
          "letter",
          "mail",
          "outbox",
          "sent",
          "tray"
        ]
      },
      {
        "shortcode": "inbox_tray",
        "glyph": "📥️",
        "keywords": [
          "box",
          "email",
          "inbox",
          "letter",
          "mail",
          "receive",
          "tray",
          "zero"
        ]
      },
      {
        "shortcode": "package",
        "glyph": "📦️",
        "keywords": [
          "box",
          "communication",
          "delivery",
          "parcel",
          "shipping"
        ]
      },
      {
        "shortcode": "mailbox",
        "glyph": "📫️",
        "keywords": [
          "closed",
          "communication",
          "flag",
          "mail",
          "mailbox",
          "postbox",
          "raised"
        ]
      },
      {
        "shortcode": "mailbox_closed",
        "glyph": "📪️",
        "keywords": [
          "closed",
          "flag",
          "lowered",
          "mail",
          "mailbox",
          "postbox"
        ]
      },
      {
        "shortcode": "mailbox_with_mail",
        "glyph": "📬️",
        "keywords": [
          "flag",
          "mail",
          "mailbox",
          "open",
          "postbox",
          "raised"
        ]
      },
      {
        "shortcode": "mailbox_with_no_mail",
        "glyph": "📭️",
        "keywords": [
          "flag",
          "lowered",
          "mail",
          "mailbox",
          "open",
          "postbox"
        ]
      },
      {
        "shortcode": "postbox",
        "glyph": "📮",
        "keywords": [
          "mail",
          "mailbox"
        ]
      },
      {
        "shortcode": "ballot_box",
        "glyph": "🗳️",
        "keywords": [
          "ballot",
          "box"
        ]
      },
      {
        "shortcode": "pencil2",
        "glyph": "✏️",
        "keywords": [
          "pencil"
        ],
        "aliases": [
          "pencil"
        ]
      },
      {
        "shortcode": "black_nib",
        "glyph": "✒️",
        "keywords": [
          "black",
          "nib",
          "pen"
        ]
      },
      {
        "shortcode": "fountain_pen",
        "glyph": "🖋️",
        "keywords": [
          "fountain",
          "pen"
        ]
      },
      {
        "shortcode": "pen",
        "glyph": "🖊️",
        "keywords": [
          "ballpoint"
        ]
      },
      {
        "shortcode": "paintbrush",
        "glyph": "🖌️",
        "keywords": [
          "painting"
        ]
      },
      {
        "shortcode": "crayon",
        "glyph": "🖍️",
        "keywords": [
          "crayon"
        ]
      },
      {
        "shortcode": "memo",
        "glyph": "📝",
        "keywords": [
          "communication",
          "media",
          "notes",
          "pencil"
        ],
        "aliases": [
          "pencil"
        ]
      },
      {
        "shortcode": "briefcase",
        "glyph": "💼",
        "keywords": [
          "office"
        ]
      },
      {
        "shortcode": "file_folder",
        "glyph": "📁",
        "keywords": [
          "file",
          "folder"
        ]
      },
      {
        "shortcode": "open_file_folder",
        "glyph": "📂",
        "keywords": [
          "file",
          "folder",
          "open"
        ]
      },
      {
        "shortcode": "card_index_dividers",
        "glyph": "🗂️",
        "keywords": [
          "card",
          "dividers",
          "index"
        ]
      },
      {
        "shortcode": "date",
        "glyph": "📅",
        "keywords": [
          "date"
        ]
      },
      {
        "shortcode": "calendar",
        "glyph": "📆",
        "keywords": [
          "calendar",
          "tear-off"
        ]
      },
      {
        "shortcode": "spiral_notepad",
        "glyph": "🗒️",
        "keywords": [
          "note",
          "notepad",
          "pad",
          "spiral"
        ],
        "aliases": [
          "notepad_spiral"
        ]
      },
      {
        "shortcode": "spiral_calendar",
        "glyph": "🗓️",
        "keywords": [
          "calendar",
          "pad",
          "spiral"
        ],
        "aliases": [
          "calendar_spiral"
        ]
      },
      {
        "shortcode": "card_index",
        "glyph": "📇",
        "keywords": [
          "card",
          "index",
          "old",
          "rolodex",
          "school"
        ]
      },
      {
        "shortcode": "chart_with_upwards_trend",
        "glyph": "📈",
        "keywords": [
          "chart",
          "data",
          "graph",
          "growth",
          "increasing",
          "right",
          "trend",
          "up",
          "upward"
        ],
        "aliases": [
          "chart_increasing"
        ]
      },
      {
        "shortcode": "chart_with_downwards_trend",
        "glyph": "📉",
        "keywords": [
          "chart",
          "data",
          "decreasing",
          "down",
          "downward",
          "graph",
          "negative",
          "trend"
        ],
        "aliases": [
          "chart_decreasing"
        ]
      },
      {
        "shortcode": "bar_chart",
        "glyph": "📊",
        "keywords": [
          "bar",
          "chart",
          "data",
          "graph"
        ]
      },
      {
        "shortcode": "clipboard",
        "glyph": "📋️",
        "keywords": [
          "do",
          "list",
          "notes"
        ]
      },
      {
        "shortcode": "pushpin",
        "glyph": "📌",
        "keywords": [
          "collage",
          "pin"
        ]
      },
      {
        "shortcode": "round_pushpin",
        "glyph": "📍",
        "keywords": [
          "location",
          "map",
          "pin",
          "pushpin",
          "round"
        ]
      },
      {
        "shortcode": "paperclip",
        "glyph": "📎",
        "keywords": [
          "paperclip"
        ]
      },
      {
        "shortcode": "paperclips",
        "glyph": "🖇️",
        "keywords": [
          "link",
          "linked",
          "paperclip",
          "paperclips"
        ]
      },
      {
        "shortcode": "straight_ruler",
        "glyph": "📏",
        "keywords": [
          "angle",
          "edge",
          "math",
          "ruler",
          "straight",
          "straightedge"
        ]
      },
      {
        "shortcode": "triangular_ruler",
        "glyph": "📐",
        "keywords": [
          "angle",
          "math",
          "rule",
          "ruler",
          "set",
          "slide",
          "triangle",
          "triangular"
        ]
      },
      {
        "shortcode": "scissors",
        "glyph": "✂️",
        "keywords": [
          "cut",
          "cutting",
          "paper",
          "tool"
        ]
      },
      {
        "shortcode": "card_file_box",
        "glyph": "🗃️",
        "keywords": [
          "box",
          "card",
          "file"
        ]
      },
      {
        "shortcode": "file_cabinet",
        "glyph": "🗄️",
        "keywords": [
          "cabinet",
          "file",
          "filing",
          "paper"
        ]
      },
      {
        "shortcode": "wastebasket",
        "glyph": "🗑️",
        "keywords": [
          "can",
          "garbage",
          "trash",
          "waste"
        ],
        "aliases": [
          "trashcan"
        ]
      },
      {
        "shortcode": "lock",
        "glyph": "🔒️",
        "keywords": [
          "closed",
          "lock",
          "private"
        ],
        "aliases": [
          "locked"
        ]
      },
      {
        "shortcode": "unlock",
        "glyph": "🔓️",
        "keywords": [
          "cracked",
          "lock",
          "open",
          "unlock"
        ],
        "aliases": [
          "unlocked"
        ]
      },
      {
        "shortcode": "lock_with_ink_pen",
        "glyph": "🔏",
        "keywords": [
          "ink",
          "lock",
          "locked",
          "nib",
          "pen",
          "privacy"
        ],
        "aliases": [
          "locked_with_pen"
        ]
      },
      {
        "shortcode": "closed_lock_with_key",
        "glyph": "🔐",
        "keywords": [
          "bike",
          "closed",
          "key",
          "lock",
          "locked",
          "secure"
        ],
        "aliases": [
          "locked_with_key"
        ]
      },
      {
        "shortcode": "key",
        "glyph": "🔑",
        "keywords": [
          "keys",
          "lock",
          "major",
          "password",
          "unlock"
        ]
      },
      {
        "shortcode": "old_key",
        "glyph": "🗝️",
        "keywords": [
          "clue",
          "key",
          "lock",
          "old"
        ]
      },
      {
        "shortcode": "hammer",
        "glyph": "🔨",
        "keywords": [
          "home",
          "improvement",
          "repairs",
          "tool"
        ]
      },
      {
        "shortcode": "axe",
        "glyph": "🪓",
        "keywords": [
          "ax",
          "chop",
          "hatchet",
          "split",
          "wood"
        ]
      },
      {
        "shortcode": "pick",
        "glyph": "⛏️",
        "keywords": [
          "hammer",
          "mining",
          "tool"
        ]
      },
      {
        "shortcode": "hammer_and_pick",
        "glyph": "⚒️",
        "keywords": [
          "hammer",
          "pick",
          "tool"
        ]
      },
      {
        "shortcode": "hammer_and_wrench",
        "glyph": "🛠️",
        "keywords": [
          "hammer",
          "spanner",
          "tool",
          "wrench"
        ]
      },
      {
        "shortcode": "dagger",
        "glyph": "🗡️",
        "keywords": [
          "knife",
          "weapon"
        ]
      },
      {
        "shortcode": "crossed_swords",
        "glyph": "⚔️",
        "keywords": [
          "crossed",
          "swords",
          "weapon"
        ]
      },
      {
        "shortcode": "bomb",
        "glyph": "💣️",
        "keywords": [
          "boom",
          "comic",
          "dangerous",
          "explosion",
          "hot"
        ]
      },
      {
        "shortcode": "boomerang",
        "glyph": "🪃",
        "keywords": [
          "rebound",
          "repercussion",
          "weapon"
        ]
      },
      {
        "shortcode": "bow_and_arrow",
        "glyph": "🏹",
        "keywords": [
          "archer",
          "archery",
          "arrow",
          "bow",
          "sagittarius",
          "tool",
          "weapon",
          "zodiac"
        ]
      },
      {
        "shortcode": "shield",
        "glyph": "🛡️",
        "keywords": [
          "weapon"
        ]
      },
      {
        "shortcode": "carpentry_saw",
        "glyph": "🪚",
        "keywords": [
          "carpenter",
          "carpentry",
          "cut",
          "lumber",
          "saw",
          "tool",
          "trim"
        ]
      },
      {
        "shortcode": "wrench",
        "glyph": "🔧",
        "keywords": [
          "home",
          "improvement",
          "spanner",
          "tool"
        ]
      },
      {
        "shortcode": "screwdriver",
        "glyph": "🪛",
        "keywords": [
          "flathead",
          "handy",
          "screw",
          "tool"
        ]
      },
      {
        "shortcode": "nut_and_bolt",
        "glyph": "🔩",
        "keywords": [
          "bolt",
          "home",
          "improvement",
          "nut",
          "tool"
        ]
      },
      {
        "shortcode": "gear",
        "glyph": "⚙️",
        "keywords": [
          "cog",
          "cogwheel",
          "tool"
        ]
      },
      {
        "shortcode": "clamp",
        "glyph": "🗜️",
        "keywords": [
          "compress",
          "tool",
          "vice"
        ],
        "aliases": [
          "compression"
        ]
      },
      {
        "shortcode": "balance_scale",
        "glyph": "⚖️",
        "keywords": [
          "balance",
          "justice",
          "libra",
          "scale",
          "scales",
          "tool",
          "weight",
          "zodiac"
        ],
        "aliases": [
          "scales"
        ]
      },
      {
        "shortcode": "probing_cane",
        "glyph": "🦯",
        "keywords": [
          "accessibility",
          "blind",
          "cane",
          "probing",
          "white"
        ],
        "aliases": [
          "white_cane"
        ]
      },
      {
        "shortcode": "link",
        "glyph": "🔗",
        "keywords": [
          "links"
        ]
      },
      {
        "shortcode": "broken_chain",
        "glyph": "⛓️‍💥",
        "keywords": [
          "break",
          "breaking",
          "broken",
          "chain",
          "cuffs",
          "freedom"
        ]
      },
      {
        "shortcode": "chains",
        "glyph": "⛓️",
        "keywords": [
          "chain"
        ]
      },
      {
        "shortcode": "hook",
        "glyph": "🪝",
        "keywords": [
          "catch",
          "crook",
          "curve",
          "ensnare",
          "point",
          "selling"
        ]
      },
      {
        "shortcode": "toolbox",
        "glyph": "🧰",
        "keywords": [
          "box",
          "chest",
          "mechanic",
          "red",
          "tool"
        ]
      },
      {
        "shortcode": "magnet",
        "glyph": "🧲",
        "keywords": [
          "attraction",
          "horseshoe",
          "magnetic",
          "negative",
          "positive",
          "shape",
          "u"
        ]
      },
      {
        "shortcode": "ladder",
        "glyph": "🪜",
        "keywords": [
          "climb",
          "rung",
          "step"
        ]
      },
      {
        "shortcode": "shovel",
        "glyph": "🪏",
        "keywords": [
          "bury",
          "dig",
          "garden",
          "hole",
          "plant",
          "scoop",
          "snow",
          "spade"
        ]
      },
      {
        "shortcode": "alembic",
        "glyph": "⚗️",
        "keywords": [
          "chemistry",
          "tool"
        ]
      },
      {
        "shortcode": "test_tube",
        "glyph": "🧪",
        "keywords": [
          "chemist",
          "chemistry",
          "experiment",
          "lab",
          "science",
          "test",
          "tube"
        ]
      },
      {
        "shortcode": "petri_dish",
        "glyph": "🧫",
        "keywords": [
          "bacteria",
          "biologist",
          "biology",
          "culture",
          "dish",
          "lab",
          "petri"
        ]
      },
      {
        "shortcode": "dna",
        "glyph": "🧬",
        "keywords": [
          "biologist",
          "evolution",
          "gene",
          "genetics",
          "life"
        ],
        "aliases": [
          "double_helix"
        ]
      },
      {
        "shortcode": "microscope",
        "glyph": "🔬",
        "keywords": [
          "experiment",
          "lab",
          "science",
          "tool"
        ]
      },
      {
        "shortcode": "telescope",
        "glyph": "🔭",
        "keywords": [
          "contact",
          "extraterrestrial",
          "science",
          "tool"
        ]
      },
      {
        "shortcode": "satellite",
        "glyph": "📡",
        "keywords": [
          "aliens",
          "antenna",
          "contact",
          "dish",
          "satellite",
          "science"
        ],
        "aliases": [
          "satellite_antenna"
        ]
      },
      {
        "shortcode": "syringe",
        "glyph": "💉",
        "keywords": [
          "doctor",
          "flu",
          "medicine",
          "needle",
          "shot",
          "sick",
          "tool",
          "vaccination"
        ]
      },
      {
        "shortcode": "drop_of_blood",
        "glyph": "🩸",
        "keywords": [
          "bleed",
          "blood",
          "donation",
          "drop",
          "injury",
          "medicine",
          "menstruation"
        ]
      },
      {
        "shortcode": "pill",
        "glyph": "💊",
        "keywords": [
          "doctor",
          "drugs",
          "medicated",
          "medicine",
          "pills",
          "sick",
          "vitamin"
        ]
      },
      {
        "shortcode": "adhesive_bandage",
        "glyph": "🩹",
        "keywords": [
          "adhesive",
          "bandage"
        ],
        "aliases": [
          "bandaid"
        ]
      },
      {
        "shortcode": "crutch",
        "glyph": "🩼",
        "keywords": [
          "aid",
          "cane",
          "disability",
          "help",
          "hurt",
          "injured",
          "mobility",
          "stick"
        ]
      },
      {
        "shortcode": "stethoscope",
        "glyph": "🩺",
        "keywords": [
          "doctor",
          "heart",
          "medicine"
        ]
      },
      {
        "shortcode": "x_ray",
        "glyph": "🩻",
        "keywords": [
          "bones",
          "doctor",
          "medical",
          "skeleton",
          "skull",
          "xray"
        ],
        "aliases": [
          "x-ray",
          "xray"
        ]
      },
      {
        "shortcode": "door",
        "glyph": "🚪",
        "keywords": [
          "back",
          "closet",
          "front"
        ]
      },
      {
        "shortcode": "elevator",
        "glyph": "🛗",
        "keywords": [
          "accessibility",
          "hoist",
          "lift"
        ]
      },
      {
        "shortcode": "mirror",
        "glyph": "🪞",
        "keywords": [
          "makeup",
          "reflection",
          "reflector",
          "speculum"
        ]
      },
      {
        "shortcode": "window",
        "glyph": "🪟",
        "keywords": [
          "air",
          "frame",
          "fresh",
          "opening",
          "transparent",
          "view"
        ]
      },
      {
        "shortcode": "bed",
        "glyph": "🛏️",
        "keywords": [
          "hotel",
          "sleep"
        ]
      },
      {
        "shortcode": "couch_and_lamp",
        "glyph": "🛋️",
        "keywords": [
          "couch",
          "hotel",
          "lamp"
        ]
      },
      {
        "shortcode": "chair",
        "glyph": "🪑",
        "keywords": [
          "seat",
          "sit"
        ]
      },
      {
        "shortcode": "toilet",
        "glyph": "🚽",
        "keywords": [
          "bathroom"
        ]
      },
      {
        "shortcode": "plunger",
        "glyph": "🪠",
        "keywords": [
          "cup",
          "force",
          "plumber",
          "poop",
          "suction",
          "toilet"
        ]
      },
      {
        "shortcode": "shower",
        "glyph": "🚿",
        "keywords": [
          "water"
        ]
      },
      {
        "shortcode": "bathtub",
        "glyph": "🛁",
        "keywords": [
          "bath"
        ]
      },
      {
        "shortcode": "mouse_trap",
        "glyph": "🪤",
        "keywords": [
          "bait",
          "cheese",
          "lure",
          "mouse",
          "mousetrap",
          "snare",
          "trap"
        ]
      },
      {
        "shortcode": "razor",
        "glyph": "🪒",
        "keywords": [
          "sharp",
          "shave"
        ]
      },
      {
        "shortcode": "lotion_bottle",
        "glyph": "🧴",
        "keywords": [
          "bottle",
          "lotion",
          "moisturizer",
          "shampoo",
          "sunscreen"
        ]
      },
      {
        "shortcode": "safety_pin",
        "glyph": "🧷",
        "keywords": [
          "diaper",
          "pin",
          "punk",
          "rock",
          "safety"
        ]
      },
      {
        "shortcode": "broom",
        "glyph": "🧹",
        "keywords": [
          "cleaning",
          "sweeping",
          "witch"
        ]
      },
      {
        "shortcode": "basket",
        "glyph": "🧺",
        "keywords": [
          "farming",
          "laundry",
          "picnic"
        ]
      },
      {
        "shortcode": "roll_of_paper",
        "glyph": "🧻",
        "keywords": [
          "paper",
          "roll",
          "toilet",
          "towels"
        ],
        "aliases": [
          "toilet_paper"
        ]
      },
      {
        "shortcode": "bucket",
        "glyph": "🪣",
        "keywords": [
          "cask",
          "pail",
          "vat"
        ]
      },
      {
        "shortcode": "soap",
        "glyph": "🧼",
        "keywords": [
          "bar",
          "bathing",
          "clean",
          "cleaning",
          "lather",
          "soapdish"
        ]
      },
      {
        "shortcode": "bubbles",
        "glyph": "🫧",
        "keywords": [
          "bubble",
          "burp",
          "clean",
          "floating",
          "pearl",
          "soap",
          "underwater"
        ]
      },
      {
        "shortcode": "toothbrush",
        "glyph": "🪥",
        "keywords": [
          "bathroom",
          "brush",
          "clean",
          "dental",
          "hygiene",
          "teeth",
          "toiletry"
        ]
      },
      {
        "shortcode": "sponge",
        "glyph": "🧽",
        "keywords": [
          "absorbing",
          "cleaning",
          "porous",
          "soak"
        ]
      },
      {
        "shortcode": "fire_extinguisher",
        "glyph": "🧯",
        "keywords": [
          "extinguish",
          "extinguisher",
          "fire",
          "quench"
        ]
      },
      {
        "shortcode": "shopping_cart",
        "glyph": "🛒",
        "keywords": [
          "cart",
          "shopping",
          "trolley"
        ]
      },
      {
        "shortcode": "smoking",
        "glyph": "🚬",
        "keywords": [
          "smoking"
        ],
        "aliases": [
          "cigarette"
        ]
      },
      {
        "shortcode": "coffin",
        "glyph": "⚰️",
        "keywords": [
          "dead",
          "death",
          "vampire"
        ]
      },
      {
        "shortcode": "headstone",
        "glyph": "🪦",
        "keywords": [
          "cemetery",
          "dead",
          "grave",
          "graveyard",
          "memorial",
          "rip",
          "tomb",
          "tombstone"
        ]
      },
      {
        "shortcode": "funeral_urn",
        "glyph": "⚱️",
        "keywords": [
          "ashes",
          "death",
          "funeral",
          "urn"
        ]
      },
      {
        "shortcode": "nazar_amulet",
        "glyph": "🧿",
        "keywords": [
          "amulet",
          "bead",
          "blue",
          "charm",
          "evil-eye",
          "nazar",
          "talisman"
        ]
      },
      {
        "shortcode": "hamsa",
        "glyph": "🪬",
        "keywords": [
          "amulet",
          "fatima",
          "fortune",
          "guide",
          "hand",
          "mary",
          "miriam",
          "palm",
          "protect",
          "protection"
        ]
      },
      {
        "shortcode": "moyai",
        "glyph": "🗿",
        "keywords": [
          "face",
          "moyai",
          "statue",
          "stoneface",
          "travel"
        ],
        "aliases": [
          "moai"
        ]
      },
      {
        "shortcode": "placard",
        "glyph": "🪧",
        "keywords": [
          "card",
          "demonstration",
          "notice",
          "picket",
          "plaque",
          "protest",
          "sign"
        ]
      },
      {
        "shortcode": "identification_card",
        "glyph": "🪪",
        "keywords": [
          "card",
          "credentials",
          "document",
          "id",
          "identification",
          "license",
          "security"
        ],
        "aliases": [
          "id_card"
        ]
      }
    ]
  },
  {
    "id": "symbols",
    "icon": "❤️",
    "name": "Symbols",
    "entries": [
      {
        "shortcode": "atm",
        "glyph": "🏧",
        "keywords": [
          "atm",
          "automated",
          "bank",
          "cash",
          "money",
          "sign",
          "teller"
        ]
      },
      {
        "shortcode": "put_litter_in_its_place",
        "glyph": "🚮",
        "keywords": [
          "bin",
          "litter",
          "litterbin",
          "sign"
        ],
        "aliases": [
          "litter_bin"
        ]
      },
      {
        "shortcode": "potable_water",
        "glyph": "🚰",
        "keywords": [
          "drinking",
          "potable",
          "water"
        ]
      },
      {
        "shortcode": "wheelchair",
        "glyph": "♿️",
        "keywords": [
          "access",
          "handicap",
          "symbol",
          "wheelchair"
        ],
        "aliases": [
          "handicapped"
        ]
      },
      {
        "shortcode": "mens",
        "glyph": "🚹️",
        "keywords": [
          "bathroom",
          "lavatory",
          "man",
          "men’s",
          "restroom",
          "room",
          "toilet",
          "wc"
        ]
      },
      {
        "shortcode": "womens",
        "glyph": "🚺️",
        "keywords": [
          "bathroom",
          "lavatory",
          "restroom",
          "room",
          "toilet",
          "wc",
          "woman",
          "women’s"
        ]
      },
      {
        "shortcode": "restroom",
        "glyph": "🚻",
        "keywords": [
          "bathroom",
          "lavatory",
          "toilet",
          "wc"
        ],
        "aliases": [
          "bathroom"
        ]
      },
      {
        "shortcode": "baby_symbol",
        "glyph": "🚼️",
        "keywords": [
          "baby",
          "changing",
          "symbol"
        ]
      },
      {
        "shortcode": "wc",
        "glyph": "🚾",
        "keywords": [
          "bathroom",
          "closet",
          "lavatory",
          "restroom",
          "toilet",
          "water",
          "wc"
        ],
        "aliases": [
          "water_closet"
        ]
      },
      {
        "shortcode": "passport_control",
        "glyph": "🛂",
        "keywords": [
          "control",
          "passport"
        ]
      },
      {
        "shortcode": "customs",
        "glyph": "🛃",
        "keywords": [
          "packing"
        ]
      },
      {
        "shortcode": "baggage_claim",
        "glyph": "🛄",
        "keywords": [
          "arrived",
          "baggage",
          "bags",
          "case",
          "checked",
          "claim",
          "journey",
          "packing",
          "plane",
          "ready",
          "travel",
          "trip"
        ]
      },
      {
        "shortcode": "left_luggage",
        "glyph": "🛅",
        "keywords": [
          "baggage",
          "case",
          "left",
          "locker",
          "luggage"
        ]
      },
      {
        "shortcode": "warning",
        "glyph": "⚠️",
        "keywords": [
          "caution"
        ]
      },
      {
        "shortcode": "children_crossing",
        "glyph": "🚸",
        "keywords": [
          "child",
          "children",
          "crossing",
          "pedestrian",
          "traffic"
        ]
      },
      {
        "shortcode": "no_entry",
        "glyph": "⛔️",
        "keywords": [
          "do",
          "entry",
          "fail",
          "forbidden",
          "no",
          "not",
          "pass",
          "prohibited",
          "traffic"
        ]
      },
      {
        "shortcode": "no_entry_sign",
        "glyph": "🚫",
        "keywords": [
          "entry",
          "forbidden",
          "no",
          "not",
          "smoke"
        ]
      },
      {
        "shortcode": "no_bicycles",
        "glyph": "🚳",
        "keywords": [
          "bicycle",
          "bicycles",
          "bike",
          "forbidden",
          "no",
          "not",
          "prohibited"
        ]
      },
      {
        "shortcode": "no_smoking",
        "glyph": "🚭️",
        "keywords": [
          "forbidden",
          "no",
          "not",
          "prohibited",
          "smoke",
          "smoking"
        ]
      },
      {
        "shortcode": "do_not_litter",
        "glyph": "🚯",
        "keywords": [
          "forbidden",
          "litter",
          "littering",
          "no",
          "not",
          "prohibited"
        ],
        "aliases": [
          "no_littering"
        ]
      },
      {
        "shortcode": "non-potable_water",
        "glyph": "🚱",
        "keywords": [
          "dry",
          "non-drinking",
          "non-potable",
          "prohibited",
          "water"
        ]
      },
      {
        "shortcode": "no_pedestrians",
        "glyph": "🚷",
        "keywords": [
          "forbidden",
          "no",
          "not",
          "pedestrian",
          "pedestrians",
          "prohibited"
        ]
      },
      {
        "shortcode": "no_mobile_phones",
        "glyph": "📵",
        "keywords": [
          "cell",
          "forbidden",
          "mobile",
          "no",
          "not",
          "phone",
          "phones",
          "prohibited",
          "telephone"
        ]
      },
      {
        "shortcode": "underage",
        "glyph": "🔞",
        "keywords": [
          "18",
          "age",
          "eighteen",
          "forbidden",
          "no",
          "not",
          "one",
          "prohibited",
          "restriction",
          "underage"
        ],
        "aliases": [
          "no_one_under_18"
        ]
      },
      {
        "shortcode": "radioactive",
        "glyph": "☢️",
        "keywords": [
          "sign"
        ]
      },
      {
        "shortcode": "biohazard",
        "glyph": "☣️",
        "keywords": [
          "sign"
        ]
      },
      {
        "shortcode": "arrow_up",
        "glyph": "⬆️",
        "keywords": [
          "arrow",
          "cardinal",
          "direction",
          "north",
          "up"
        ]
      },
      {
        "shortcode": "arrow_upper_right",
        "glyph": "↗️",
        "keywords": [
          "arrow",
          "direction",
          "intercardinal",
          "northeast",
          "up-right"
        ]
      },
      {
        "shortcode": "arrow_right",
        "glyph": "➡️",
        "keywords": [
          "arrow",
          "cardinal",
          "direction",
          "east",
          "right"
        ]
      },
      {
        "shortcode": "arrow_lower_right",
        "glyph": "↘️",
        "keywords": [
          "arrow",
          "direction",
          "down-right",
          "intercardinal",
          "southeast"
        ]
      },
      {
        "shortcode": "arrow_down",
        "glyph": "⬇️",
        "keywords": [
          "arrow",
          "cardinal",
          "direction",
          "down",
          "south"
        ]
      },
      {
        "shortcode": "arrow_lower_left",
        "glyph": "↙️",
        "keywords": [
          "arrow",
          "direction",
          "down-left",
          "intercardinal",
          "southwest"
        ]
      },
      {
        "shortcode": "arrow_left",
        "glyph": "⬅️",
        "keywords": [
          "arrow",
          "cardinal",
          "direction",
          "left",
          "west"
        ]
      },
      {
        "shortcode": "arrow_upper_left",
        "glyph": "↖️",
        "keywords": [
          "arrow",
          "direction",
          "intercardinal",
          "northwest",
          "up-left"
        ]
      },
      {
        "shortcode": "arrow_up_down",
        "glyph": "↕️",
        "keywords": [
          "arrow",
          "up-down"
        ]
      },
      {
        "shortcode": "left_right_arrow",
        "glyph": "↔️",
        "keywords": [
          "arrow",
          "left-right"
        ]
      },
      {
        "shortcode": "leftwards_arrow_with_hook",
        "glyph": "↩️",
        "keywords": [
          "arrow",
          "curving",
          "left",
          "right"
        ],
        "aliases": [
          "arrow_left_hook"
        ]
      },
      {
        "shortcode": "arrow_right_hook",
        "glyph": "↪️",
        "keywords": [
          "arrow",
          "curving",
          "left",
          "right"
        ],
        "aliases": [
          "rightwards_arrow_with_hook"
        ]
      },
      {
        "shortcode": "arrow_heading_up",
        "glyph": "⤴️",
        "keywords": [
          "arrow",
          "curving",
          "right",
          "up"
        ]
      },
      {
        "shortcode": "arrow_heading_down",
        "glyph": "⤵️",
        "keywords": [
          "arrow",
          "curving",
          "down",
          "right"
        ]
      },
      {
        "shortcode": "arrows_clockwise",
        "glyph": "🔃",
        "keywords": [
          "arrow",
          "arrows",
          "clockwise",
          "refresh",
          "reload",
          "vertical"
        ],
        "aliases": [
          "clockwise"
        ]
      },
      {
        "shortcode": "arrows_counterclockwise",
        "glyph": "🔄",
        "keywords": [
          "again",
          "anticlockwise",
          "arrow",
          "arrows",
          "button",
          "counterclockwise",
          "deja",
          "refresh",
          "rewindershins",
          "vu"
        ],
        "aliases": [
          "counterclockwise"
        ]
      },
      {
        "shortcode": "back",
        "glyph": "🔙",
        "keywords": [
          "arrow",
          "back"
        ]
      },
      {
        "shortcode": "end",
        "glyph": "🔚",
        "keywords": [
          "arrow",
          "end"
        ]
      },
      {
        "shortcode": "on",
        "glyph": "🔛",
        "keywords": [
          "arrow",
          "mark",
          "on!"
        ]
      },
      {
        "shortcode": "soon",
        "glyph": "🔜",
        "keywords": [
          "arrow",
          "brb",
          "omw",
          "soon"
        ]
      },
      {
        "shortcode": "top",
        "glyph": "🔝",
        "keywords": [
          "arrow",
          "homie",
          "top",
          "up"
        ]
      },
      {
        "shortcode": "place_of_worship",
        "glyph": "🛐",
        "keywords": [
          "place",
          "pray",
          "religion",
          "worship"
        ]
      },
      {
        "shortcode": "atom_symbol",
        "glyph": "⚛️",
        "keywords": [
          "atheist",
          "atom",
          "symbol"
        ],
        "aliases": [
          "atom"
        ]
      },
      {
        "shortcode": "om",
        "glyph": "🕉️",
        "keywords": [
          "hindu",
          "religion"
        ]
      },
      {
        "shortcode": "star_of_david",
        "glyph": "✡️",
        "keywords": [
          "david",
          "jew",
          "jewish",
          "judaism",
          "religion",
          "star"
        ]
      },
      {
        "shortcode": "wheel_of_dharma",
        "glyph": "☸️",
        "keywords": [
          "buddhist",
          "dharma",
          "religion",
          "wheel"
        ]
      },
      {
        "shortcode": "yin_yang",
        "glyph": "☯️",
        "keywords": [
          "difficult",
          "lives",
          "religion",
          "tao",
          "taoist",
          "total",
          "yang",
          "yin",
          "yinyang"
        ]
      },
      {
        "shortcode": "latin_cross",
        "glyph": "✝️",
        "keywords": [
          "christ",
          "christian",
          "cross",
          "latin",
          "religion"
        ]
      },
      {
        "shortcode": "orthodox_cross",
        "glyph": "☦️",
        "keywords": [
          "christian",
          "cross",
          "orthodox",
          "religion"
        ]
      },
      {
        "shortcode": "star_and_crescent",
        "glyph": "☪️",
        "keywords": [
          "crescent",
          "islam",
          "muslim",
          "ramadan",
          "religion",
          "star"
        ]
      },
      {
        "shortcode": "peace_symbol",
        "glyph": "☮️",
        "keywords": [
          "healing",
          "peace",
          "peaceful",
          "symbol"
        ],
        "aliases": [
          "peace"
        ]
      },
      {
        "shortcode": "menorah",
        "glyph": "🕎",
        "keywords": [
          "candelabrum",
          "candlestick",
          "hanukkah",
          "jewish",
          "judaism",
          "religion"
        ]
      },
      {
        "shortcode": "six_pointed_star",
        "glyph": "🔯",
        "keywords": [
          "dotted",
          "fortune",
          "jewish",
          "judaism",
          "six-pointed",
          "star"
        ]
      },
      {
        "shortcode": "khanda",
        "glyph": "🪯",
        "keywords": [
          "deg",
          "fateh",
          "khalsa",
          "religion",
          "sikh",
          "sikhism",
          "tegh"
        ]
      },
      {
        "shortcode": "aries",
        "glyph": "♈️",
        "keywords": [
          "aries",
          "horoscope",
          "ram",
          "zodiac"
        ]
      },
      {
        "shortcode": "taurus",
        "glyph": "♉️",
        "keywords": [
          "bull",
          "horoscope",
          "ox",
          "taurus",
          "zodiac"
        ]
      },
      {
        "shortcode": "gemini",
        "glyph": "♊️",
        "keywords": [
          "gemini",
          "horoscope",
          "twins",
          "zodiac"
        ]
      },
      {
        "shortcode": "cancer",
        "glyph": "♋️",
        "keywords": [
          "cancer",
          "crab",
          "horoscope",
          "zodiac"
        ]
      },
      {
        "shortcode": "leo",
        "glyph": "♌️",
        "keywords": [
          "horoscope",
          "leo",
          "lion",
          "zodiac"
        ]
      },
      {
        "shortcode": "virgo",
        "glyph": "♍️",
        "keywords": [
          "horoscope",
          "virgo",
          "zodiac"
        ]
      },
      {
        "shortcode": "libra",
        "glyph": "♎️",
        "keywords": [
          "balance",
          "horoscope",
          "justice",
          "libra",
          "scales",
          "zodiac"
        ]
      },
      {
        "shortcode": "scorpius",
        "glyph": "♏️",
        "keywords": [
          "horoscope",
          "scorpio",
          "scorpion",
          "scorpius",
          "zodiac"
        ]
      },
      {
        "shortcode": "sagittarius",
        "glyph": "♐️",
        "keywords": [
          "archer",
          "horoscope",
          "sagittarius",
          "zodiac"
        ]
      },
      {
        "shortcode": "capricorn",
        "glyph": "♑️",
        "keywords": [
          "capricorn",
          "goat",
          "horoscope",
          "zodiac"
        ]
      },
      {
        "shortcode": "aquarius",
        "glyph": "♒️",
        "keywords": [
          "aquarius",
          "bearer",
          "horoscope",
          "water",
          "zodiac"
        ]
      },
      {
        "shortcode": "pisces",
        "glyph": "♓️",
        "keywords": [
          "fish",
          "horoscope",
          "pisces",
          "zodiac"
        ]
      },
      {
        "shortcode": "ophiuchus",
        "glyph": "⛎️",
        "keywords": [
          "bearer",
          "ophiuchus",
          "serpent",
          "snake",
          "zodiac"
        ]
      },
      {
        "shortcode": "twisted_rightwards_arrows",
        "glyph": "🔀",
        "keywords": [
          "arrow",
          "button",
          "crossed",
          "shuffle",
          "tracks"
        ],
        "aliases": [
          "shuffle"
        ]
      },
      {
        "shortcode": "repeat",
        "glyph": "🔁",
        "keywords": [
          "arrow",
          "button",
          "clockwise",
          "repeat"
        ]
      },
      {
        "shortcode": "repeat_one",
        "glyph": "🔂",
        "keywords": [
          "arrow",
          "button",
          "clockwise",
          "once",
          "repeat",
          "single"
        ]
      },
      {
        "shortcode": "arrow_forward",
        "glyph": "▶️",
        "keywords": [
          "arrow",
          "button",
          "play",
          "right",
          "triangle"
        ],
        "aliases": [
          "play"
        ]
      },
      {
        "shortcode": "fast_forward",
        "glyph": "⏩️",
        "keywords": [
          "arrow",
          "button",
          "double",
          "fast",
          "fast-forward",
          "forward"
        ]
      },
      {
        "shortcode": "next_track_button",
        "glyph": "⏭️",
        "keywords": [
          "arrow",
          "button",
          "next",
          "scene",
          "track",
          "triangle"
        ],
        "aliases": [
          "next_track"
        ]
      },
      {
        "shortcode": "play_or_pause_button",
        "glyph": "⏯️",
        "keywords": [
          "arrow",
          "button",
          "pause",
          "play",
          "right",
          "triangle"
        ],
        "aliases": [
          "play_pause"
        ]
      },
      {
        "shortcode": "arrow_backward",
        "glyph": "◀️",
        "keywords": [
          "arrow",
          "button",
          "left",
          "reverse",
          "triangle"
        ],
        "aliases": [
          "reverse"
        ]
      },
      {
        "shortcode": "rewind",
        "glyph": "⏪️",
        "keywords": [
          "arrow",
          "button",
          "double",
          "fast",
          "reverse",
          "rewind"
        ],
        "aliases": [
          "fast_reverse"
        ]
      },
      {
        "shortcode": "previous_track_button",
        "glyph": "⏮️",
        "keywords": [
          "arrow",
          "button",
          "last",
          "previous",
          "scene",
          "track",
          "triangle"
        ],
        "aliases": [
          "previous_track"
        ]
      },
      {
        "shortcode": "arrow_up_small",
        "glyph": "🔼",
        "keywords": [
          "arrow",
          "button",
          "red",
          "up",
          "upwards"
        ],
        "aliases": [
          "up"
        ]
      },
      {
        "shortcode": "arrow_double_up",
        "glyph": "⏫️",
        "keywords": [
          "arrow",
          "button",
          "double",
          "fast",
          "up"
        ],
        "aliases": [
          "fast_up"
        ]
      },
      {
        "shortcode": "arrow_down_small",
        "glyph": "🔽",
        "keywords": [
          "arrow",
          "button",
          "down",
          "downwards",
          "red"
        ],
        "aliases": [
          "down"
        ]
      },
      {
        "shortcode": "arrow_double_down",
        "glyph": "⏬️",
        "keywords": [
          "arrow",
          "button",
          "double",
          "down",
          "fast"
        ],
        "aliases": [
          "fast_down"
        ]
      },
      {
        "shortcode": "pause_button",
        "glyph": "⏸️",
        "keywords": [
          "bar",
          "button",
          "double",
          "pause",
          "vertical"
        ],
        "aliases": [
          "pause"
        ]
      },
      {
        "shortcode": "stop_button",
        "glyph": "⏹️",
        "keywords": [
          "button",
          "square",
          "stop"
        ],
        "aliases": [
          "stop"
        ]
      },
      {
        "shortcode": "record_button",
        "glyph": "⏺️",
        "keywords": [
          "button",
          "circle",
          "record"
        ],
        "aliases": [
          "record"
        ]
      },
      {
        "shortcode": "eject_button",
        "glyph": "⏏️",
        "keywords": [
          "button",
          "eject"
        ],
        "aliases": [
          "eject"
        ]
      },
      {
        "shortcode": "cinema",
        "glyph": "🎦",
        "keywords": [
          "camera",
          "film",
          "movie"
        ]
      },
      {
        "shortcode": "low_brightness",
        "glyph": "🔅",
        "keywords": [
          "brightness",
          "button",
          "dim",
          "low"
        ],
        "aliases": [
          "dim_button"
        ]
      },
      {
        "shortcode": "high_brightness",
        "glyph": "🔆",
        "keywords": [
          "bright",
          "brightness",
          "button",
          "light"
        ],
        "aliases": [
          "bright_button"
        ]
      },
      {
        "shortcode": "signal_strength",
        "glyph": "📶",
        "keywords": [
          "antenna",
          "bar",
          "bars",
          "cell",
          "communication",
          "mobile",
          "phone",
          "signal",
          "telephone"
        ],
        "aliases": [
          "antenna_bars"
        ]
      },
      {
        "shortcode": "wireless",
        "glyph": "🛜",
        "keywords": [
          "broadband",
          "computer",
          "connectivity",
          "hotspot",
          "internet",
          "network",
          "router",
          "smartphone",
          "wi-fi",
          "wifi",
          "wlan"
        ]
      },
      {
        "shortcode": "vibration_mode",
        "glyph": "📳",
        "keywords": [
          "cell",
          "communication",
          "mobile",
          "mode",
          "phone",
          "telephone",
          "vibration"
        ]
      },
      {
        "shortcode": "mobile_phone_off",
        "glyph": "📴",
        "keywords": [
          "cell",
          "mobile",
          "off",
          "phone",
          "telephone"
        ]
      },
      {
        "shortcode": "female_sign",
        "glyph": "♀️",
        "keywords": [
          "female",
          "sign",
          "woman"
        ],
        "aliases": [
          "female"
        ]
      },
      {
        "shortcode": "male_sign",
        "glyph": "♂️",
        "keywords": [
          "male",
          "man",
          "sign"
        ],
        "aliases": [
          "male"
        ]
      },
      {
        "shortcode": "transgender_symbol",
        "glyph": "⚧️",
        "keywords": [
          "symbol",
          "transgender"
        ]
      },
      {
        "shortcode": "heavy_multiplication_x",
        "glyph": "✖️",
        "keywords": [
          "cancel",
          "multiplication",
          "sign",
          "x",
          "×"
        ],
        "aliases": [
          "multiplication",
          "multiply"
        ]
      },
      {
        "shortcode": "heavy_plus_sign",
        "glyph": "➕️",
        "keywords": [
          "+"
        ],
        "aliases": [
          "plus"
        ]
      },
      {
        "shortcode": "heavy_minus_sign",
        "glyph": "➖️",
        "keywords": [
          "-",
          "heavy",
          "math",
          "sign",
          "−"
        ],
        "aliases": [
          "minus"
        ]
      },
      {
        "shortcode": "heavy_division_sign",
        "glyph": "➗️",
        "keywords": [
          "division",
          "heavy",
          "math",
          "sign",
          "÷"
        ],
        "aliases": [
          "divide",
          "division"
        ]
      },
      {
        "shortcode": "heavy_equals_sign",
        "glyph": "🟰",
        "keywords": [
          "answer",
          "equal",
          "equality",
          "equals",
          "heavy",
          "math",
          "sign"
        ]
      },
      {
        "shortcode": "infinity",
        "glyph": "♾️",
        "keywords": [
          "forever",
          "unbounded",
          "universal"
        ]
      },
      {
        "shortcode": "bangbang",
        "glyph": "‼️",
        "keywords": [
          "!",
          "!!",
          "bangbang",
          "double",
          "exclamation",
          "mark",
          "punctuation"
        ],
        "aliases": [
          "double_exclamation"
        ]
      },
      {
        "shortcode": "interrobang",
        "glyph": "⁉️",
        "keywords": [
          "!",
          "!?",
          "?",
          "exclamation",
          "interrobang",
          "mark",
          "punctuation",
          "question"
        ],
        "aliases": [
          "exclamation_question"
        ]
      },
      {
        "shortcode": "question",
        "glyph": "❓️",
        "keywords": [
          "?",
          "mark",
          "punctuation",
          "question",
          "red"
        ]
      },
      {
        "shortcode": "grey_question",
        "glyph": "❔️",
        "keywords": [
          "?",
          "mark",
          "outlined",
          "punctuation",
          "question",
          "white"
        ],
        "aliases": [
          "white_question"
        ]
      },
      {
        "shortcode": "grey_exclamation",
        "glyph": "❕️",
        "keywords": [
          "!",
          "exclamation",
          "mark",
          "outlined",
          "punctuation",
          "white"
        ],
        "aliases": [
          "white_exclamation"
        ]
      },
      {
        "shortcode": "exclamation",
        "glyph": "❗️",
        "keywords": [
          "!",
          "exclamation",
          "mark",
          "punctuation",
          "red"
        ],
        "aliases": [
          "heavy_exclamation_mark"
        ]
      },
      {
        "shortcode": "wavy_dash",
        "glyph": "〰️",
        "keywords": [
          "dash",
          "punctuation",
          "wavy"
        ]
      },
      {
        "shortcode": "currency_exchange",
        "glyph": "💱",
        "keywords": [
          "bank",
          "currency",
          "exchange",
          "money"
        ]
      },
      {
        "shortcode": "heavy_dollar_sign",
        "glyph": "💲",
        "keywords": [
          "billion",
          "cash",
          "charge",
          "currency",
          "dollar",
          "heavy",
          "million",
          "money",
          "pay",
          "sign"
        ]
      },
      {
        "shortcode": "medical_symbol",
        "glyph": "⚕️",
        "keywords": [
          "aesculapius",
          "medical",
          "medicine",
          "staff",
          "symbol"
        ],
        "aliases": [
          "medical"
        ]
      },
      {
        "shortcode": "recycle",
        "glyph": "♻️",
        "keywords": [
          "recycle",
          "recycling",
          "symbol"
        ],
        "aliases": [
          "recycling_symbol"
        ]
      },
      {
        "shortcode": "fleur_de_lis",
        "glyph": "⚜️",
        "keywords": [
          "knights"
        ],
        "aliases": [
          "fleur-de-lis"
        ]
      },
      {
        "shortcode": "trident",
        "glyph": "🔱",
        "keywords": [
          "anchor",
          "emblem",
          "poseidon",
          "ship",
          "tool",
          "trident"
        ]
      },
      {
        "shortcode": "name_badge",
        "glyph": "📛",
        "keywords": [
          "badge",
          "name"
        ]
      },
      {
        "shortcode": "beginner",
        "glyph": "🔰",
        "keywords": [
          "beginner",
          "chevron",
          "green",
          "japanese",
          "leaf",
          "symbol",
          "tool",
          "yellow"
        ]
      },
      {
        "shortcode": "o",
        "glyph": "⭕️",
        "keywords": [
          "circle",
          "heavy",
          "hollow",
          "large",
          "o",
          "red"
        ],
        "aliases": [
          "hollow_red_circle",
          "red_o"
        ]
      },
      {
        "shortcode": "white_check_mark",
        "glyph": "✅️",
        "keywords": [
          "button",
          "check",
          "checked",
          "checkmark",
          "complete",
          "completed",
          "done",
          "fixed",
          "mark",
          "tick",
          "✓"
        ],
        "aliases": [
          "check_mark_button"
        ]
      },
      {
        "shortcode": "ballot_box_with_check",
        "glyph": "☑️",
        "keywords": [
          "ballot",
          "box",
          "check",
          "checked",
          "done",
          "off",
          "tick",
          "✓"
        ]
      },
      {
        "shortcode": "heavy_check_mark",
        "glyph": "✔️",
        "keywords": [
          "check",
          "checked",
          "checkmark",
          "done",
          "heavy",
          "mark",
          "tick",
          "✓"
        ],
        "aliases": [
          "check_mark"
        ]
      },
      {
        "shortcode": "x",
        "glyph": "❌️",
        "keywords": [
          "cancel",
          "cross",
          "mark",
          "multiplication",
          "multiply",
          "x",
          "×"
        ],
        "aliases": [
          "cross_mark"
        ]
      },
      {
        "shortcode": "negative_squared_cross_mark",
        "glyph": "❎️",
        "keywords": [
          "button",
          "cross",
          "mark",
          "multiplication",
          "multiply",
          "square",
          "x",
          "×"
        ],
        "aliases": [
          "cross_mark_button"
        ]
      },
      {
        "shortcode": "curly_loop",
        "glyph": "➰️",
        "keywords": [
          "curl",
          "curly",
          "loop"
        ]
      },
      {
        "shortcode": "loop",
        "glyph": "➿️",
        "keywords": [
          "curl",
          "curly",
          "double",
          "loop"
        ],
        "aliases": [
          "double_curly_loop"
        ]
      },
      {
        "shortcode": "part_alternation_mark",
        "glyph": "〽️",
        "keywords": [
          "alternation",
          "mark",
          "part"
        ]
      },
      {
        "shortcode": "eight_spoked_asterisk",
        "glyph": "✳️",
        "keywords": [
          "*",
          "asterisk",
          "eight-spoked"
        ]
      },
      {
        "shortcode": "eight_pointed_black_star",
        "glyph": "✴️",
        "keywords": [
          "*",
          "eight-pointed",
          "star"
        ]
      },
      {
        "shortcode": "sparkle",
        "glyph": "❇️",
        "keywords": [
          "*"
        ]
      },
      {
        "shortcode": "copyright",
        "glyph": "©️",
        "keywords": [
          "c"
        ]
      },
      {
        "shortcode": "registered",
        "glyph": "®️",
        "keywords": [
          "r"
        ]
      },
      {
        "shortcode": "tm",
        "glyph": "™️",
        "keywords": [
          "mark",
          "tm",
          "trade",
          "trademark"
        ],
        "aliases": [
          "trade_mark"
        ]
      },
      {
        "shortcode": "splatter",
        "glyph": "🫟",
        "keywords": [
          "drip",
          "holi",
          "ink",
          "liquid",
          "mess",
          "paint",
          "spill",
          "stain"
        ]
      },
      {
        "shortcode": "hash",
        "glyph": "#️⃣",
        "keywords": [
          "keycap"
        ],
        "aliases": [
          "number_sign"
        ]
      },
      {
        "shortcode": "asterisk",
        "glyph": "*️⃣",
        "keywords": [
          "keycap"
        ]
      },
      {
        "shortcode": "zero",
        "glyph": "0️⃣",
        "keywords": [
          "0",
          "keycap",
          "zero"
        ]
      },
      {
        "shortcode": "one",
        "glyph": "1️⃣",
        "keywords": [
          "1",
          "keycap",
          "one"
        ]
      },
      {
        "shortcode": "two",
        "glyph": "2️⃣",
        "keywords": [
          "2",
          "keycap",
          "two"
        ]
      },
      {
        "shortcode": "three",
        "glyph": "3️⃣",
        "keywords": [
          "3",
          "keycap",
          "three"
        ]
      },
      {
        "shortcode": "four",
        "glyph": "4️⃣",
        "keywords": [
          "4",
          "four",
          "keycap"
        ]
      },
      {
        "shortcode": "five",
        "glyph": "5️⃣",
        "keywords": [
          "5",
          "five",
          "keycap"
        ]
      },
      {
        "shortcode": "six",
        "glyph": "6️⃣",
        "keywords": [
          "6",
          "keycap",
          "six"
        ]
      },
      {
        "shortcode": "seven",
        "glyph": "7️⃣",
        "keywords": [
          "7",
          "keycap",
          "seven"
        ]
      },
      {
        "shortcode": "eight",
        "glyph": "8️⃣",
        "keywords": [
          "8",
          "eight",
          "keycap"
        ]
      },
      {
        "shortcode": "nine",
        "glyph": "9️⃣",
        "keywords": [
          "9",
          "keycap",
          "nine"
        ]
      },
      {
        "shortcode": "keycap_ten",
        "glyph": "🔟",
        "keywords": [
          "keycap"
        ],
        "aliases": [
          "ten"
        ]
      },
      {
        "shortcode": "capital_abcd",
        "glyph": "🔠",
        "keywords": [
          "abcd",
          "input",
          "latin",
          "letters",
          "uppercase"
        ]
      },
      {
        "shortcode": "abcd",
        "glyph": "🔡",
        "keywords": [
          "abcd",
          "input",
          "latin",
          "letters",
          "lowercase"
        ]
      },
      {
        "shortcode": "1234",
        "glyph": "🔢",
        "keywords": [
          "1234",
          "input",
          "numbers"
        ]
      },
      {
        "shortcode": "symbols",
        "glyph": "🔣",
        "keywords": [
          "%",
          "&",
          "input",
          "symbols",
          "♪",
          "〒"
        ]
      },
      {
        "shortcode": "abc",
        "glyph": "🔤",
        "keywords": [
          "abc",
          "alphabet",
          "input",
          "latin",
          "letters"
        ]
      },
      {
        "shortcode": "a",
        "glyph": "🅰️",
        "keywords": [
          "blood",
          "button",
          "type"
        ],
        "aliases": [
          "a_blood"
        ]
      },
      {
        "shortcode": "ab",
        "glyph": "🆎",
        "keywords": [
          "ab",
          "blood",
          "button",
          "type"
        ],
        "aliases": [
          "ab_blood"
        ]
      },
      {
        "shortcode": "b",
        "glyph": "🅱️",
        "keywords": [
          "b",
          "blood",
          "button",
          "type"
        ],
        "aliases": [
          "b_blood"
        ]
      },
      {
        "shortcode": "cl",
        "glyph": "🆑",
        "keywords": [
          "button",
          "cl"
        ]
      },
      {
        "shortcode": "cool",
        "glyph": "🆒",
        "keywords": [
          "button",
          "cool"
        ]
      },
      {
        "shortcode": "free",
        "glyph": "🆓",
        "keywords": [
          "button",
          "free"
        ]
      },
      {
        "shortcode": "information_source",
        "glyph": "ℹ️",
        "keywords": [
          "i"
        ],
        "aliases": [
          "info"
        ]
      },
      {
        "shortcode": "id",
        "glyph": "🆔",
        "keywords": [
          "button",
          "id",
          "identity"
        ]
      },
      {
        "shortcode": "m",
        "glyph": "Ⓜ️",
        "keywords": [
          "circle",
          "circled",
          "m"
        ]
      },
      {
        "shortcode": "new",
        "glyph": "🆕",
        "keywords": [
          "button",
          "new"
        ]
      },
      {
        "shortcode": "ng",
        "glyph": "🆖",
        "keywords": [
          "button",
          "ng"
        ]
      },
      {
        "shortcode": "o2",
        "glyph": "🅾️",
        "keywords": [
          "blood",
          "button",
          "o",
          "type"
        ],
        "aliases": [
          "o",
          "o_blood"
        ]
      },
      {
        "shortcode": "ok",
        "glyph": "🆗",
        "keywords": [
          "button",
          "ok",
          "okay"
        ]
      },
      {
        "shortcode": "parking",
        "glyph": "🅿️",
        "keywords": [
          "button",
          "p",
          "parking"
        ]
      },
      {
        "shortcode": "sos",
        "glyph": "🆘",
        "keywords": [
          "button",
          "help",
          "sos"
        ]
      },
      {
        "shortcode": "up",
        "glyph": "🆙",
        "keywords": [
          "button",
          "mark",
          "up",
          "up!"
        ],
        "aliases": [
          "up2"
        ]
      },
      {
        "shortcode": "vs",
        "glyph": "🆚",
        "keywords": [
          "button",
          "versus",
          "vs"
        ]
      },
      {
        "shortcode": "koko",
        "glyph": "🈁",
        "keywords": [
          "button",
          "here",
          "japanese",
          "katakana"
        ],
        "aliases": [
          "ja_here"
        ]
      },
      {
        "shortcode": "sa",
        "glyph": "🈂️",
        "keywords": [
          "button",
          "charge",
          "japanese",
          "katakana",
          "service"
        ],
        "aliases": [
          "ja_service_charge"
        ]
      },
      {
        "shortcode": "u6708",
        "glyph": "🈷️",
        "keywords": [
          "amount",
          "button",
          "ideograph",
          "japanese",
          "monthly"
        ],
        "aliases": [
          "ja_monthly_amount"
        ]
      },
      {
        "shortcode": "u6709",
        "glyph": "🈶",
        "keywords": [
          "button",
          "charge",
          "free",
          "ideograph",
          "japanese",
          "not"
        ],
        "aliases": [
          "ja_not_free_of_carge"
        ]
      },
      {
        "shortcode": "u6307",
        "glyph": "🈯️",
        "keywords": [
          "button",
          "ideograph",
          "japanese",
          "reserved"
        ],
        "aliases": [
          "ja_reserved"
        ]
      },
      {
        "shortcode": "ideograph_advantage",
        "glyph": "🉐",
        "keywords": [
          "bargain",
          "button",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_bargain"
        ]
      },
      {
        "shortcode": "u5272",
        "glyph": "🈹",
        "keywords": [
          "button",
          "discount",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_discount"
        ]
      },
      {
        "shortcode": "u7121",
        "glyph": "🈚️",
        "keywords": [
          "button",
          "charge",
          "free",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_free_of_charge"
        ]
      },
      {
        "shortcode": "u7981",
        "glyph": "🈲",
        "keywords": [
          "button",
          "ideograph",
          "japanese",
          "prohibited"
        ],
        "aliases": [
          "ja_prohibited"
        ]
      },
      {
        "shortcode": "accept",
        "glyph": "🉑",
        "keywords": [
          "acceptable",
          "button",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_acceptable"
        ]
      },
      {
        "shortcode": "u7533",
        "glyph": "🈸",
        "keywords": [
          "application",
          "button",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_application"
        ]
      },
      {
        "shortcode": "u5408",
        "glyph": "🈴",
        "keywords": [
          "button",
          "grade",
          "ideograph",
          "japanese",
          "passing"
        ],
        "aliases": [
          "ja_passing_grade"
        ]
      },
      {
        "shortcode": "u7a7a",
        "glyph": "🈳",
        "keywords": [
          "button",
          "ideograph",
          "japanese",
          "vacancy"
        ],
        "aliases": [
          "ja_vacancy"
        ]
      },
      {
        "shortcode": "congratulations",
        "glyph": "㊗️",
        "keywords": [
          "button",
          "congratulations",
          "ideograph",
          "japanese"
        ],
        "aliases": [
          "ja_congratulations"
        ]
      },
      {
        "shortcode": "secret",
        "glyph": "㊙️",
        "keywords": [
          "button",
          "ideograph",
          "japanese",
          "secret"
        ],
        "aliases": [
          "ja_secret"
        ]
      },
      {
        "shortcode": "u55b6",
        "glyph": "🈺",
        "keywords": [
          "business",
          "button",
          "ideograph",
          "japanese",
          "open"
        ],
        "aliases": [
          "ja_open_for_business"
        ]
      },
      {
        "shortcode": "u6e80",
        "glyph": "🈵",
        "keywords": [
          "button",
          "ideograph",
          "japanese",
          "no",
          "vacancy"
        ],
        "aliases": [
          "ja_no_vacancy"
        ]
      },
      {
        "shortcode": "red_circle",
        "glyph": "🔴",
        "keywords": [
          "circle",
          "geometric",
          "red"
        ]
      },
      {
        "shortcode": "orange_circle",
        "glyph": "🟠",
        "keywords": [
          "circle",
          "orange"
        ]
      },
      {
        "shortcode": "yellow_circle",
        "glyph": "🟡",
        "keywords": [
          "circle",
          "yellow"
        ]
      },
      {
        "shortcode": "green_circle",
        "glyph": "🟢",
        "keywords": [
          "circle",
          "green"
        ]
      },
      {
        "shortcode": "large_blue_circle",
        "glyph": "🔵",
        "keywords": [
          "blue",
          "circle",
          "geometric"
        ],
        "aliases": [
          "blue_circle"
        ]
      },
      {
        "shortcode": "purple_circle",
        "glyph": "🟣",
        "keywords": [
          "circle",
          "purple"
        ]
      },
      {
        "shortcode": "brown_circle",
        "glyph": "🟤",
        "keywords": [
          "brown",
          "circle"
        ]
      },
      {
        "shortcode": "black_circle",
        "glyph": "⚫️",
        "keywords": [
          "black",
          "circle",
          "geometric"
        ]
      },
      {
        "shortcode": "white_circle",
        "glyph": "⚪️",
        "keywords": [
          "circle",
          "geometric",
          "white"
        ]
      },
      {
        "shortcode": "red_square",
        "glyph": "🟥",
        "keywords": [
          "card",
          "penalty",
          "red",
          "square"
        ]
      },
      {
        "shortcode": "orange_square",
        "glyph": "🟧",
        "keywords": [
          "orange",
          "square"
        ]
      },
      {
        "shortcode": "yellow_square",
        "glyph": "🟨",
        "keywords": [
          "card",
          "penalty",
          "square",
          "yellow"
        ]
      },
      {
        "shortcode": "green_square",
        "glyph": "🟩",
        "keywords": [
          "green",
          "square"
        ]
      },
      {
        "shortcode": "blue_square",
        "glyph": "🟦",
        "keywords": [
          "blue",
          "square"
        ]
      },
      {
        "shortcode": "purple_square",
        "glyph": "🟪",
        "keywords": [
          "purple",
          "square"
        ]
      },
      {
        "shortcode": "brown_square",
        "glyph": "🟫",
        "keywords": [
          "brown",
          "square"
        ]
      },
      {
        "shortcode": "black_large_square",
        "glyph": "⬛️",
        "keywords": [
          "black",
          "geometric",
          "large",
          "square"
        ]
      },
      {
        "shortcode": "white_large_square",
        "glyph": "⬜️",
        "keywords": [
          "geometric",
          "large",
          "square",
          "white"
        ]
      },
      {
        "shortcode": "black_medium_square",
        "glyph": "◼️",
        "keywords": [
          "black",
          "geometric",
          "medium",
          "square"
        ]
      },
      {
        "shortcode": "white_medium_square",
        "glyph": "◻️",
        "keywords": [
          "geometric",
          "medium",
          "square",
          "white"
        ]
      },
      {
        "shortcode": "black_medium_small_square",
        "glyph": "◾️",
        "keywords": [
          "black",
          "geometric",
          "medium-small",
          "square"
        ]
      },
      {
        "shortcode": "white_medium_small_square",
        "glyph": "◽️",
        "keywords": [
          "geometric",
          "medium-small",
          "square",
          "white"
        ]
      },
      {
        "shortcode": "black_small_square",
        "glyph": "▪️",
        "keywords": [
          "black",
          "geometric",
          "small",
          "square"
        ]
      },
      {
        "shortcode": "white_small_square",
        "glyph": "▫️",
        "keywords": [
          "geometric",
          "small",
          "square",
          "white"
        ]
      },
      {
        "shortcode": "large_orange_diamond",
        "glyph": "🔶",
        "keywords": [
          "diamond",
          "geometric",
          "large",
          "orange"
        ]
      },
      {
        "shortcode": "large_blue_diamond",
        "glyph": "🔷",
        "keywords": [
          "blue",
          "diamond",
          "geometric",
          "large"
        ]
      },
      {
        "shortcode": "small_orange_diamond",
        "glyph": "🔸",
        "keywords": [
          "diamond",
          "geometric",
          "orange",
          "small"
        ]
      },
      {
        "shortcode": "small_blue_diamond",
        "glyph": "🔹",
        "keywords": [
          "blue",
          "diamond",
          "geometric",
          "small"
        ]
      },
      {
        "shortcode": "small_red_triangle",
        "glyph": "🔺",
        "keywords": [
          "geometric",
          "pointed",
          "red",
          "triangle",
          "up"
        ]
      },
      {
        "shortcode": "small_red_triangle_down",
        "glyph": "🔻",
        "keywords": [
          "down",
          "geometric",
          "pointed",
          "red",
          "triangle"
        ]
      },
      {
        "shortcode": "diamond_shape_with_a_dot_inside",
        "glyph": "💠",
        "keywords": [
          "comic",
          "diamond",
          "dot",
          "geometric"
        ],
        "aliases": [
          "diamond_with_a_dot"
        ]
      },
      {
        "shortcode": "radio_button",
        "glyph": "🔘",
        "keywords": [
          "button",
          "geometric",
          "radio"
        ]
      },
      {
        "shortcode": "white_square_button",
        "glyph": "🔳",
        "keywords": [
          "button",
          "geometric",
          "outlined",
          "square",
          "white"
        ]
      },
      {
        "shortcode": "black_square_button",
        "glyph": "🔲",
        "keywords": [
          "black",
          "button",
          "geometric",
          "square"
        ]
      }
    ]
  },
  {
    "id": "flags",
    "icon": "🏁",
    "name": "Flags",
    "entries": [
      {
        "shortcode": "checkered_flag",
        "glyph": "🏁",
        "keywords": [
          "checkered",
          "chequered",
          "finish",
          "flag",
          "flags",
          "game",
          "race",
          "racing",
          "sport",
          "win"
        ]
      },
      {
        "shortcode": "triangular_flag_on_post",
        "glyph": "🚩",
        "keywords": [
          "construction",
          "flag",
          "golf",
          "post",
          "triangular"
        ],
        "aliases": [
          "triangular_flag"
        ]
      },
      {
        "shortcode": "crossed_flags",
        "glyph": "🎌",
        "keywords": [
          "celebration",
          "cross",
          "crossed",
          "flags",
          "japanese"
        ]
      },
      {
        "shortcode": "black_flag",
        "glyph": "🏴",
        "keywords": [
          "black",
          "flag",
          "waving"
        ]
      },
      {
        "shortcode": "white_flag",
        "glyph": "🏳️",
        "keywords": [
          "flag",
          "waving",
          "white"
        ]
      },
      {
        "shortcode": "rainbow_flag",
        "glyph": "🏳️‍🌈",
        "keywords": [
          "bisexual",
          "flag",
          "gay",
          "genderqueer",
          "glbt",
          "glbtq",
          "lesbian",
          "lgbt",
          "lgbtq",
          "lgbtqia",
          "pride",
          "queer",
          "rainbow",
          "trans",
          "transgender"
        ]
      },
      {
        "shortcode": "transgender_flag",
        "glyph": "🏳️‍⚧️",
        "keywords": [
          "blue",
          "flag",
          "light",
          "pink",
          "transgender",
          "white"
        ]
      },
      {
        "shortcode": "pirate_flag",
        "glyph": "🏴‍☠️",
        "keywords": [
          "flag",
          "jolly",
          "pirate",
          "plunder",
          "roger",
          "treasure"
        ],
        "aliases": [
          "jolly_roger"
        ]
      },
      {
        "shortcode": "ascension_island",
        "glyph": "🇦🇨",
        "keywords": [
          "AC",
          "flag"
        ],
        "aliases": [
          "flag_ac"
        ]
      },
      {
        "shortcode": "andorra",
        "glyph": "🇦🇩",
        "keywords": [
          "AD",
          "flag"
        ],
        "aliases": [
          "flag_ad"
        ]
      },
      {
        "shortcode": "united_arab_emirates",
        "glyph": "🇦🇪",
        "keywords": [
          "AE",
          "flag"
        ],
        "aliases": [
          "flag_ae"
        ]
      },
      {
        "shortcode": "afghanistan",
        "glyph": "🇦🇫",
        "keywords": [
          "AF",
          "flag"
        ],
        "aliases": [
          "flag_af"
        ]
      },
      {
        "shortcode": "antigua_barbuda",
        "glyph": "🇦🇬",
        "keywords": [
          "AG",
          "flag"
        ],
        "aliases": [
          "flag_ag"
        ]
      },
      {
        "shortcode": "anguilla",
        "glyph": "🇦🇮",
        "keywords": [
          "AI",
          "flag"
        ],
        "aliases": [
          "flag_ai"
        ]
      },
      {
        "shortcode": "albania",
        "glyph": "🇦🇱",
        "keywords": [
          "AL",
          "flag"
        ],
        "aliases": [
          "flag_al"
        ]
      },
      {
        "shortcode": "armenia",
        "glyph": "🇦🇲",
        "keywords": [
          "AM",
          "flag"
        ],
        "aliases": [
          "flag_am"
        ]
      },
      {
        "shortcode": "angola",
        "glyph": "🇦🇴",
        "keywords": [
          "AO",
          "flag"
        ],
        "aliases": [
          "flag_ao"
        ]
      },
      {
        "shortcode": "antarctica",
        "glyph": "🇦🇶",
        "keywords": [
          "AQ",
          "flag"
        ],
        "aliases": [
          "flag_aq"
        ]
      },
      {
        "shortcode": "argentina",
        "glyph": "🇦🇷",
        "keywords": [
          "AR",
          "flag"
        ],
        "aliases": [
          "flag_ar"
        ]
      },
      {
        "shortcode": "american_samoa",
        "glyph": "🇦🇸",
        "keywords": [
          "AS",
          "flag"
        ],
        "aliases": [
          "flag_as"
        ]
      },
      {
        "shortcode": "austria",
        "glyph": "🇦🇹",
        "keywords": [
          "AT",
          "flag"
        ],
        "aliases": [
          "flag_at"
        ]
      },
      {
        "shortcode": "australia",
        "glyph": "🇦🇺",
        "keywords": [
          "AU",
          "flag"
        ],
        "aliases": [
          "flag_au"
        ]
      },
      {
        "shortcode": "aruba",
        "glyph": "🇦🇼",
        "keywords": [
          "AW",
          "flag"
        ],
        "aliases": [
          "flag_aw"
        ]
      },
      {
        "shortcode": "aland_islands",
        "glyph": "🇦🇽",
        "keywords": [
          "AX",
          "flag"
        ],
        "aliases": [
          "flag_ax"
        ]
      },
      {
        "shortcode": "azerbaijan",
        "glyph": "🇦🇿",
        "keywords": [
          "AZ",
          "flag"
        ],
        "aliases": [
          "flag_az"
        ]
      },
      {
        "shortcode": "bosnia_herzegovina",
        "glyph": "🇧🇦",
        "keywords": [
          "BA",
          "flag"
        ],
        "aliases": [
          "flag_ba"
        ]
      },
      {
        "shortcode": "barbados",
        "glyph": "🇧🇧",
        "keywords": [
          "BB",
          "flag"
        ],
        "aliases": [
          "flag_bb"
        ]
      },
      {
        "shortcode": "bangladesh",
        "glyph": "🇧🇩",
        "keywords": [
          "BD",
          "flag"
        ],
        "aliases": [
          "flag_bd"
        ]
      },
      {
        "shortcode": "belgium",
        "glyph": "🇧🇪",
        "keywords": [
          "BE",
          "flag"
        ],
        "aliases": [
          "flag_be"
        ]
      },
      {
        "shortcode": "burkina_faso",
        "glyph": "🇧🇫",
        "keywords": [
          "BF",
          "flag"
        ],
        "aliases": [
          "flag_bf"
        ]
      },
      {
        "shortcode": "bulgaria",
        "glyph": "🇧🇬",
        "keywords": [
          "BG",
          "flag"
        ],
        "aliases": [
          "flag_bg"
        ]
      },
      {
        "shortcode": "bahrain",
        "glyph": "🇧🇭",
        "keywords": [
          "BH",
          "flag"
        ],
        "aliases": [
          "flag_bh"
        ]
      },
      {
        "shortcode": "burundi",
        "glyph": "🇧🇮",
        "keywords": [
          "BI",
          "flag"
        ],
        "aliases": [
          "flag_bi"
        ]
      },
      {
        "shortcode": "benin",
        "glyph": "🇧🇯",
        "keywords": [
          "BJ",
          "flag"
        ],
        "aliases": [
          "flag_bj"
        ]
      },
      {
        "shortcode": "st_barthelemy",
        "glyph": "🇧🇱",
        "keywords": [
          "BL",
          "flag"
        ],
        "aliases": [
          "flag_bl"
        ]
      },
      {
        "shortcode": "bermuda",
        "glyph": "🇧🇲",
        "keywords": [
          "BM",
          "flag"
        ],
        "aliases": [
          "flag_bm"
        ]
      },
      {
        "shortcode": "brunei",
        "glyph": "🇧🇳",
        "keywords": [
          "BN",
          "flag"
        ],
        "aliases": [
          "flag_bn"
        ]
      },
      {
        "shortcode": "bolivia",
        "glyph": "🇧🇴",
        "keywords": [
          "BO",
          "flag"
        ],
        "aliases": [
          "flag_bo"
        ]
      },
      {
        "shortcode": "caribbean_netherlands",
        "glyph": "🇧🇶",
        "keywords": [
          "BQ",
          "flag"
        ],
        "aliases": [
          "flag_bq"
        ]
      },
      {
        "shortcode": "brazil",
        "glyph": "🇧🇷",
        "keywords": [
          "BR",
          "flag"
        ],
        "aliases": [
          "flag_br"
        ]
      },
      {
        "shortcode": "bahamas",
        "glyph": "🇧🇸",
        "keywords": [
          "BS",
          "flag"
        ],
        "aliases": [
          "flag_bs"
        ]
      },
      {
        "shortcode": "bhutan",
        "glyph": "🇧🇹",
        "keywords": [
          "BT",
          "flag"
        ],
        "aliases": [
          "flag_bt"
        ]
      },
      {
        "shortcode": "bouvet_island",
        "glyph": "🇧🇻",
        "keywords": [
          "BV",
          "flag"
        ],
        "aliases": [
          "flag_bv"
        ]
      },
      {
        "shortcode": "botswana",
        "glyph": "🇧🇼",
        "keywords": [
          "BW",
          "flag"
        ],
        "aliases": [
          "flag_bw"
        ]
      },
      {
        "shortcode": "belarus",
        "glyph": "🇧🇾",
        "keywords": [
          "BY",
          "flag"
        ],
        "aliases": [
          "flag_by"
        ]
      },
      {
        "shortcode": "belize",
        "glyph": "🇧🇿",
        "keywords": [
          "BZ",
          "flag"
        ],
        "aliases": [
          "flag_bz"
        ]
      },
      {
        "shortcode": "canada",
        "glyph": "🇨🇦",
        "keywords": [
          "CA",
          "flag"
        ],
        "aliases": [
          "flag_ca"
        ]
      },
      {
        "shortcode": "cocos_islands",
        "glyph": "🇨🇨",
        "keywords": [
          "CC",
          "flag"
        ],
        "aliases": [
          "flag_cc"
        ]
      },
      {
        "shortcode": "congo_kinshasa",
        "glyph": "🇨🇩",
        "keywords": [
          "CD",
          "flag"
        ],
        "aliases": [
          "flag_cd"
        ]
      },
      {
        "shortcode": "central_african_republic",
        "glyph": "🇨🇫",
        "keywords": [
          "CF",
          "flag"
        ],
        "aliases": [
          "flag_cf"
        ]
      },
      {
        "shortcode": "congo_brazzaville",
        "glyph": "🇨🇬",
        "keywords": [
          "CG",
          "flag"
        ],
        "aliases": [
          "flag_cg"
        ]
      },
      {
        "shortcode": "switzerland",
        "glyph": "🇨🇭",
        "keywords": [
          "CH",
          "flag"
        ],
        "aliases": [
          "flag_ch"
        ]
      },
      {
        "shortcode": "cote_divoire",
        "glyph": "🇨🇮",
        "keywords": [
          "CI",
          "flag"
        ],
        "aliases": [
          "flag_ci"
        ]
      },
      {
        "shortcode": "cook_islands",
        "glyph": "🇨🇰",
        "keywords": [
          "CK",
          "flag"
        ],
        "aliases": [
          "flag_ck"
        ]
      },
      {
        "shortcode": "chile",
        "glyph": "🇨🇱",
        "keywords": [
          "CL",
          "flag"
        ],
        "aliases": [
          "flag_cl"
        ]
      },
      {
        "shortcode": "cameroon",
        "glyph": "🇨🇲",
        "keywords": [
          "CM",
          "flag"
        ],
        "aliases": [
          "flag_cm"
        ]
      },
      {
        "shortcode": "cn",
        "glyph": "🇨🇳",
        "keywords": [
          "CN",
          "flag"
        ],
        "aliases": [
          "china",
          "flag_cn"
        ]
      },
      {
        "shortcode": "colombia",
        "glyph": "🇨🇴",
        "keywords": [
          "CO",
          "flag"
        ],
        "aliases": [
          "flag_co"
        ]
      },
      {
        "shortcode": "clipperton_island",
        "glyph": "🇨🇵",
        "keywords": [
          "CP",
          "flag"
        ],
        "aliases": [
          "flag_cp"
        ]
      },
      {
        "shortcode": "flag_cq",
        "glyph": "🇨🇶",
        "keywords": [
          "CQ",
          "flag"
        ],
        "aliases": [
          "sark"
        ]
      },
      {
        "shortcode": "costa_rica",
        "glyph": "🇨🇷",
        "keywords": [
          "CR",
          "flag"
        ],
        "aliases": [
          "flag_cr"
        ]
      },
      {
        "shortcode": "cuba",
        "glyph": "🇨🇺",
        "keywords": [
          "CU",
          "flag"
        ],
        "aliases": [
          "flag_cu"
        ]
      },
      {
        "shortcode": "cape_verde",
        "glyph": "🇨🇻",
        "keywords": [
          "CV",
          "flag"
        ],
        "aliases": [
          "flag_cv"
        ]
      },
      {
        "shortcode": "curacao",
        "glyph": "🇨🇼",
        "keywords": [
          "CW",
          "flag"
        ],
        "aliases": [
          "flag_cw"
        ]
      },
      {
        "shortcode": "christmas_island",
        "glyph": "🇨🇽",
        "keywords": [
          "CX",
          "flag"
        ],
        "aliases": [
          "flag_cx"
        ]
      },
      {
        "shortcode": "cyprus",
        "glyph": "🇨🇾",
        "keywords": [
          "CY",
          "flag"
        ],
        "aliases": [
          "flag_cy"
        ]
      },
      {
        "shortcode": "czech_republic",
        "glyph": "🇨🇿",
        "keywords": [
          "CZ",
          "flag"
        ],
        "aliases": [
          "czechia",
          "flag_cz"
        ]
      },
      {
        "shortcode": "de",
        "glyph": "🇩🇪",
        "keywords": [
          "DE",
          "flag"
        ],
        "aliases": [
          "flag_de",
          "germany"
        ]
      },
      {
        "shortcode": "diego_garcia",
        "glyph": "🇩🇬",
        "keywords": [
          "DG",
          "flag"
        ],
        "aliases": [
          "flag_dg"
        ]
      },
      {
        "shortcode": "djibouti",
        "glyph": "🇩🇯",
        "keywords": [
          "DJ",
          "flag"
        ],
        "aliases": [
          "flag_dj"
        ]
      },
      {
        "shortcode": "denmark",
        "glyph": "🇩🇰",
        "keywords": [
          "DK",
          "flag"
        ],
        "aliases": [
          "flag_dk"
        ]
      },
      {
        "shortcode": "dominica",
        "glyph": "🇩🇲",
        "keywords": [
          "DM",
          "flag"
        ],
        "aliases": [
          "flag_dm"
        ]
      },
      {
        "shortcode": "dominican_republic",
        "glyph": "🇩🇴",
        "keywords": [
          "DO",
          "flag"
        ],
        "aliases": [
          "flag_do"
        ]
      },
      {
        "shortcode": "algeria",
        "glyph": "🇩🇿",
        "keywords": [
          "DZ",
          "flag"
        ],
        "aliases": [
          "flag_dz"
        ]
      },
      {
        "shortcode": "ceuta_melilla",
        "glyph": "🇪🇦",
        "keywords": [
          "EA",
          "flag"
        ],
        "aliases": [
          "flag_ea"
        ]
      },
      {
        "shortcode": "ecuador",
        "glyph": "🇪🇨",
        "keywords": [
          "EC",
          "flag"
        ],
        "aliases": [
          "flag_ec"
        ]
      },
      {
        "shortcode": "estonia",
        "glyph": "🇪🇪",
        "keywords": [
          "EE",
          "flag"
        ],
        "aliases": [
          "flag_ee"
        ]
      },
      {
        "shortcode": "egypt",
        "glyph": "🇪🇬",
        "keywords": [
          "EG",
          "flag"
        ],
        "aliases": [
          "flag_eg"
        ]
      },
      {
        "shortcode": "western_sahara",
        "glyph": "🇪🇭",
        "keywords": [
          "EH",
          "flag"
        ],
        "aliases": [
          "flag_eh"
        ]
      },
      {
        "shortcode": "eritrea",
        "glyph": "🇪🇷",
        "keywords": [
          "ER",
          "flag"
        ],
        "aliases": [
          "flag_er"
        ]
      },
      {
        "shortcode": "es",
        "glyph": "🇪🇸",
        "keywords": [
          "ES",
          "flag"
        ],
        "aliases": [
          "flag_es",
          "spain"
        ]
      },
      {
        "shortcode": "ethiopia",
        "glyph": "🇪🇹",
        "keywords": [
          "ET",
          "flag"
        ],
        "aliases": [
          "flag_et"
        ]
      },
      {
        "shortcode": "eu",
        "glyph": "🇪🇺",
        "keywords": [
          "EU",
          "flag"
        ],
        "aliases": [
          "european_union",
          "flag_eu"
        ]
      },
      {
        "shortcode": "finland",
        "glyph": "🇫🇮",
        "keywords": [
          "FI",
          "flag"
        ],
        "aliases": [
          "flag_fi"
        ]
      },
      {
        "shortcode": "fiji",
        "glyph": "🇫🇯",
        "keywords": [
          "FJ",
          "flag"
        ],
        "aliases": [
          "flag_fj"
        ]
      },
      {
        "shortcode": "falkland_islands",
        "glyph": "🇫🇰",
        "keywords": [
          "FK",
          "flag"
        ],
        "aliases": [
          "flag_fk"
        ]
      },
      {
        "shortcode": "micronesia",
        "glyph": "🇫🇲",
        "keywords": [
          "FM",
          "flag"
        ],
        "aliases": [
          "flag_fm"
        ]
      },
      {
        "shortcode": "faroe_islands",
        "glyph": "🇫🇴",
        "keywords": [
          "FO",
          "flag"
        ],
        "aliases": [
          "flag_fo"
        ]
      },
      {
        "shortcode": "fr",
        "glyph": "🇫🇷",
        "keywords": [
          "FR",
          "flag"
        ],
        "aliases": [
          "flag_fr",
          "france"
        ]
      },
      {
        "shortcode": "gabon",
        "glyph": "🇬🇦",
        "keywords": [
          "GA",
          "flag"
        ],
        "aliases": [
          "flag_ga"
        ]
      },
      {
        "shortcode": "gb",
        "glyph": "🇬🇧",
        "keywords": [
          "GB",
          "flag"
        ],
        "aliases": [
          "uk",
          "flag_gb",
          "united_kingdom"
        ]
      },
      {
        "shortcode": "grenada",
        "glyph": "🇬🇩",
        "keywords": [
          "GD",
          "flag"
        ],
        "aliases": [
          "flag_gd"
        ]
      },
      {
        "shortcode": "georgia",
        "glyph": "🇬🇪",
        "keywords": [
          "GE",
          "flag"
        ],
        "aliases": [
          "flag_ge"
        ]
      },
      {
        "shortcode": "french_guiana",
        "glyph": "🇬🇫",
        "keywords": [
          "GF",
          "flag"
        ],
        "aliases": [
          "flag_gf"
        ]
      },
      {
        "shortcode": "guernsey",
        "glyph": "🇬🇬",
        "keywords": [
          "GG",
          "flag"
        ],
        "aliases": [
          "flag_gg"
        ]
      },
      {
        "shortcode": "ghana",
        "glyph": "🇬🇭",
        "keywords": [
          "GH",
          "flag"
        ],
        "aliases": [
          "flag_gh"
        ]
      },
      {
        "shortcode": "gibraltar",
        "glyph": "🇬🇮",
        "keywords": [
          "GI",
          "flag"
        ],
        "aliases": [
          "flag_gi"
        ]
      },
      {
        "shortcode": "greenland",
        "glyph": "🇬🇱",
        "keywords": [
          "GL",
          "flag"
        ],
        "aliases": [
          "flag_gl"
        ]
      },
      {
        "shortcode": "gambia",
        "glyph": "🇬🇲",
        "keywords": [
          "GM",
          "flag"
        ],
        "aliases": [
          "flag_gm"
        ]
      },
      {
        "shortcode": "guinea",
        "glyph": "🇬🇳",
        "keywords": [
          "GN",
          "flag"
        ],
        "aliases": [
          "flag_gn"
        ]
      },
      {
        "shortcode": "guadeloupe",
        "glyph": "🇬🇵",
        "keywords": [
          "GP",
          "flag"
        ],
        "aliases": [
          "flag_gp"
        ]
      },
      {
        "shortcode": "equatorial_guinea",
        "glyph": "🇬🇶",
        "keywords": [
          "GQ",
          "flag"
        ],
        "aliases": [
          "flag_gq"
        ]
      },
      {
        "shortcode": "greece",
        "glyph": "🇬🇷",
        "keywords": [
          "GR",
          "flag"
        ],
        "aliases": [
          "flag_gr"
        ]
      },
      {
        "shortcode": "south_georgia_south_sandwich_islands",
        "glyph": "🇬🇸",
        "keywords": [
          "GS",
          "flag"
        ],
        "aliases": [
          "flag_gs"
        ]
      },
      {
        "shortcode": "guatemala",
        "glyph": "🇬🇹",
        "keywords": [
          "GT",
          "flag"
        ],
        "aliases": [
          "flag_gt"
        ]
      },
      {
        "shortcode": "guam",
        "glyph": "🇬🇺",
        "keywords": [
          "GU",
          "flag"
        ],
        "aliases": [
          "flag_gu"
        ]
      },
      {
        "shortcode": "guinea_bissau",
        "glyph": "🇬🇼",
        "keywords": [
          "GW",
          "flag"
        ],
        "aliases": [
          "flag_gw"
        ]
      },
      {
        "shortcode": "guyana",
        "glyph": "🇬🇾",
        "keywords": [
          "GY",
          "flag"
        ],
        "aliases": [
          "flag_gy"
        ]
      },
      {
        "shortcode": "hong_kong",
        "glyph": "🇭🇰",
        "keywords": [
          "HK",
          "flag"
        ],
        "aliases": [
          "flag_hk"
        ]
      },
      {
        "shortcode": "heard_mcdonald_islands",
        "glyph": "🇭🇲",
        "keywords": [
          "HM",
          "flag"
        ],
        "aliases": [
          "flag_hm"
        ]
      },
      {
        "shortcode": "honduras",
        "glyph": "🇭🇳",
        "keywords": [
          "HN",
          "flag"
        ],
        "aliases": [
          "flag_hn"
        ]
      },
      {
        "shortcode": "croatia",
        "glyph": "🇭🇷",
        "keywords": [
          "HR",
          "flag"
        ],
        "aliases": [
          "flag_hr"
        ]
      },
      {
        "shortcode": "haiti",
        "glyph": "🇭🇹",
        "keywords": [
          "HT",
          "flag"
        ],
        "aliases": [
          "flag_ht"
        ]
      },
      {
        "shortcode": "hungary",
        "glyph": "🇭🇺",
        "keywords": [
          "HU",
          "flag"
        ],
        "aliases": [
          "flag_hu"
        ]
      },
      {
        "shortcode": "canary_islands",
        "glyph": "🇮🇨",
        "keywords": [
          "IC",
          "flag"
        ],
        "aliases": [
          "flag_ic"
        ]
      },
      {
        "shortcode": "indonesia",
        "glyph": "🇮🇩",
        "keywords": [
          "ID",
          "flag"
        ],
        "aliases": [
          "flag_id"
        ]
      },
      {
        "shortcode": "ireland",
        "glyph": "🇮🇪",
        "keywords": [
          "IE",
          "flag"
        ],
        "aliases": [
          "flag_ie"
        ]
      },
      {
        "shortcode": "israel",
        "glyph": "🇮🇱",
        "keywords": [
          "IL",
          "flag"
        ],
        "aliases": [
          "flag_il"
        ]
      },
      {
        "shortcode": "isle_of_man",
        "glyph": "🇮🇲",
        "keywords": [
          "IM",
          "flag"
        ],
        "aliases": [
          "flag_im"
        ]
      },
      {
        "shortcode": "india",
        "glyph": "🇮🇳",
        "keywords": [
          "IN",
          "flag"
        ],
        "aliases": [
          "flag_in"
        ]
      },
      {
        "shortcode": "british_indian_ocean_territory",
        "glyph": "🇮🇴",
        "keywords": [
          "IO",
          "flag"
        ],
        "aliases": [
          "flag_io"
        ]
      },
      {
        "shortcode": "iraq",
        "glyph": "🇮🇶",
        "keywords": [
          "IQ",
          "flag"
        ],
        "aliases": [
          "flag_iq"
        ]
      },
      {
        "shortcode": "iran",
        "glyph": "🇮🇷",
        "keywords": [
          "IR",
          "flag"
        ],
        "aliases": [
          "flag_ir"
        ]
      },
      {
        "shortcode": "iceland",
        "glyph": "🇮🇸",
        "keywords": [
          "IS",
          "flag"
        ],
        "aliases": [
          "flag_is"
        ]
      },
      {
        "shortcode": "it",
        "glyph": "🇮🇹",
        "keywords": [
          "IT",
          "flag"
        ],
        "aliases": [
          "flag_it",
          "italy"
        ]
      },
      {
        "shortcode": "jersey",
        "glyph": "🇯🇪",
        "keywords": [
          "JE",
          "flag"
        ],
        "aliases": [
          "flag_je"
        ]
      },
      {
        "shortcode": "jamaica",
        "glyph": "🇯🇲",
        "keywords": [
          "JM",
          "flag"
        ],
        "aliases": [
          "flag_jm"
        ]
      },
      {
        "shortcode": "jordan",
        "glyph": "🇯🇴",
        "keywords": [
          "JO",
          "flag"
        ],
        "aliases": [
          "flag_jo"
        ]
      },
      {
        "shortcode": "jp",
        "glyph": "🇯🇵",
        "keywords": [
          "JP",
          "flag"
        ],
        "aliases": [
          "flag_jp",
          "japan"
        ]
      },
      {
        "shortcode": "kenya",
        "glyph": "🇰🇪",
        "keywords": [
          "KE",
          "flag"
        ],
        "aliases": [
          "flag_ke"
        ]
      },
      {
        "shortcode": "kyrgyzstan",
        "glyph": "🇰🇬",
        "keywords": [
          "KG",
          "flag"
        ],
        "aliases": [
          "flag_kg"
        ]
      },
      {
        "shortcode": "cambodia",
        "glyph": "🇰🇭",
        "keywords": [
          "KH",
          "flag"
        ],
        "aliases": [
          "flag_kh"
        ]
      },
      {
        "shortcode": "kiribati",
        "glyph": "🇰🇮",
        "keywords": [
          "KI",
          "flag"
        ],
        "aliases": [
          "flag_ki"
        ]
      },
      {
        "shortcode": "comoros",
        "glyph": "🇰🇲",
        "keywords": [
          "KM",
          "flag"
        ],
        "aliases": [
          "flag_km"
        ]
      },
      {
        "shortcode": "st_kitts_nevis",
        "glyph": "🇰🇳",
        "keywords": [
          "KN",
          "flag"
        ],
        "aliases": [
          "flag_kn"
        ]
      },
      {
        "shortcode": "north_korea",
        "glyph": "🇰🇵",
        "keywords": [
          "KP",
          "flag"
        ],
        "aliases": [
          "flag_kp"
        ]
      },
      {
        "shortcode": "kr",
        "glyph": "🇰🇷",
        "keywords": [
          "KR",
          "flag"
        ],
        "aliases": [
          "flag_kr",
          "south_korea"
        ]
      },
      {
        "shortcode": "kuwait",
        "glyph": "🇰🇼",
        "keywords": [
          "KW",
          "flag"
        ],
        "aliases": [
          "flag_kw"
        ]
      },
      {
        "shortcode": "cayman_islands",
        "glyph": "🇰🇾",
        "keywords": [
          "KY",
          "flag"
        ],
        "aliases": [
          "flag_ky"
        ]
      },
      {
        "shortcode": "kazakhstan",
        "glyph": "🇰🇿",
        "keywords": [
          "KZ",
          "flag"
        ],
        "aliases": [
          "flag_kz"
        ]
      },
      {
        "shortcode": "laos",
        "glyph": "🇱🇦",
        "keywords": [
          "LA",
          "flag"
        ],
        "aliases": [
          "flag_la"
        ]
      },
      {
        "shortcode": "lebanon",
        "glyph": "🇱🇧",
        "keywords": [
          "LB",
          "flag"
        ],
        "aliases": [
          "flag_lb"
        ]
      },
      {
        "shortcode": "st_lucia",
        "glyph": "🇱🇨",
        "keywords": [
          "LC",
          "flag"
        ],
        "aliases": [
          "flag_lc"
        ]
      },
      {
        "shortcode": "liechtenstein",
        "glyph": "🇱🇮",
        "keywords": [
          "LI",
          "flag"
        ],
        "aliases": [
          "flag_li"
        ]
      },
      {
        "shortcode": "sri_lanka",
        "glyph": "🇱🇰",
        "keywords": [
          "LK",
          "flag"
        ],
        "aliases": [
          "flag_lk"
        ]
      },
      {
        "shortcode": "liberia",
        "glyph": "🇱🇷",
        "keywords": [
          "LR",
          "flag"
        ],
        "aliases": [
          "flag_lr"
        ]
      },
      {
        "shortcode": "lesotho",
        "glyph": "🇱🇸",
        "keywords": [
          "LS",
          "flag"
        ],
        "aliases": [
          "flag_ls"
        ]
      },
      {
        "shortcode": "lithuania",
        "glyph": "🇱🇹",
        "keywords": [
          "LT",
          "flag"
        ],
        "aliases": [
          "flag_lt"
        ]
      },
      {
        "shortcode": "luxembourg",
        "glyph": "🇱🇺",
        "keywords": [
          "LU",
          "flag"
        ],
        "aliases": [
          "flag_lu"
        ]
      },
      {
        "shortcode": "latvia",
        "glyph": "🇱🇻",
        "keywords": [
          "LV",
          "flag"
        ],
        "aliases": [
          "flag_lv"
        ]
      },
      {
        "shortcode": "libya",
        "glyph": "🇱🇾",
        "keywords": [
          "LY",
          "flag"
        ],
        "aliases": [
          "flag_ly"
        ]
      },
      {
        "shortcode": "morocco",
        "glyph": "🇲🇦",
        "keywords": [
          "MA",
          "flag"
        ],
        "aliases": [
          "flag_ma"
        ]
      },
      {
        "shortcode": "monaco",
        "glyph": "🇲🇨",
        "keywords": [
          "MC",
          "flag"
        ],
        "aliases": [
          "flag_mc"
        ]
      },
      {
        "shortcode": "moldova",
        "glyph": "🇲🇩",
        "keywords": [
          "MD",
          "flag"
        ],
        "aliases": [
          "flag_md"
        ]
      },
      {
        "shortcode": "montenegro",
        "glyph": "🇲🇪",
        "keywords": [
          "ME",
          "flag"
        ],
        "aliases": [
          "flag_me"
        ]
      },
      {
        "shortcode": "st_martin",
        "glyph": "🇲🇫",
        "keywords": [
          "MF",
          "flag"
        ],
        "aliases": [
          "flag_mf"
        ]
      },
      {
        "shortcode": "madagascar",
        "glyph": "🇲🇬",
        "keywords": [
          "MG",
          "flag"
        ],
        "aliases": [
          "flag_mg"
        ]
      },
      {
        "shortcode": "marshall_islands",
        "glyph": "🇲🇭",
        "keywords": [
          "MH",
          "flag"
        ],
        "aliases": [
          "flag_mh"
        ]
      },
      {
        "shortcode": "macedonia",
        "glyph": "🇲🇰",
        "keywords": [
          "MK",
          "flag"
        ],
        "aliases": [
          "flag_mk"
        ]
      },
      {
        "shortcode": "mali",
        "glyph": "🇲🇱",
        "keywords": [
          "ML",
          "flag"
        ],
        "aliases": [
          "flag_ml"
        ]
      },
      {
        "shortcode": "myanmar",
        "glyph": "🇲🇲",
        "keywords": [
          "MM",
          "flag"
        ],
        "aliases": [
          "burma",
          "flag_mm"
        ]
      },
      {
        "shortcode": "mongolia",
        "glyph": "🇲🇳",
        "keywords": [
          "MN",
          "flag"
        ],
        "aliases": [
          "flag_mn"
        ]
      },
      {
        "shortcode": "macau",
        "glyph": "🇲🇴",
        "keywords": [
          "MO",
          "flag"
        ],
        "aliases": [
          "flag_mo",
          "macao"
        ]
      },
      {
        "shortcode": "northern_mariana_islands",
        "glyph": "🇲🇵",
        "keywords": [
          "MP",
          "flag"
        ],
        "aliases": [
          "flag_mp"
        ]
      },
      {
        "shortcode": "martinique",
        "glyph": "🇲🇶",
        "keywords": [
          "MQ",
          "flag"
        ],
        "aliases": [
          "flag_mq"
        ]
      },
      {
        "shortcode": "mauritania",
        "glyph": "🇲🇷",
        "keywords": [
          "MR",
          "flag"
        ],
        "aliases": [
          "flag_mr"
        ]
      },
      {
        "shortcode": "montserrat",
        "glyph": "🇲🇸",
        "keywords": [
          "MS",
          "flag"
        ],
        "aliases": [
          "flag_ms"
        ]
      },
      {
        "shortcode": "malta",
        "glyph": "🇲🇹",
        "keywords": [
          "MT",
          "flag"
        ],
        "aliases": [
          "flag_mt"
        ]
      },
      {
        "shortcode": "mauritius",
        "glyph": "🇲🇺",
        "keywords": [
          "MU",
          "flag"
        ],
        "aliases": [
          "flag_mu"
        ]
      },
      {
        "shortcode": "maldives",
        "glyph": "🇲🇻",
        "keywords": [
          "MV",
          "flag"
        ],
        "aliases": [
          "flag_mv"
        ]
      },
      {
        "shortcode": "malawi",
        "glyph": "🇲🇼",
        "keywords": [
          "MW",
          "flag"
        ],
        "aliases": [
          "flag_mw"
        ]
      },
      {
        "shortcode": "mexico",
        "glyph": "🇲🇽",
        "keywords": [
          "MX",
          "flag"
        ],
        "aliases": [
          "flag_mx"
        ]
      },
      {
        "shortcode": "malaysia",
        "glyph": "🇲🇾",
        "keywords": [
          "MY",
          "flag"
        ],
        "aliases": [
          "flag_my"
        ]
      },
      {
        "shortcode": "mozambique",
        "glyph": "🇲🇿",
        "keywords": [
          "MZ",
          "flag"
        ],
        "aliases": [
          "flag_mz"
        ]
      },
      {
        "shortcode": "namibia",
        "glyph": "🇳🇦",
        "keywords": [
          "NA",
          "flag"
        ],
        "aliases": [
          "flag_na"
        ]
      },
      {
        "shortcode": "new_caledonia",
        "glyph": "🇳🇨",
        "keywords": [
          "NC",
          "flag"
        ],
        "aliases": [
          "flag_nc"
        ]
      },
      {
        "shortcode": "niger",
        "glyph": "🇳🇪",
        "keywords": [
          "NE",
          "flag"
        ],
        "aliases": [
          "flag_ne"
        ]
      },
      {
        "shortcode": "norfolk_island",
        "glyph": "🇳🇫",
        "keywords": [
          "NF",
          "flag"
        ],
        "aliases": [
          "flag_nf"
        ]
      },
      {
        "shortcode": "nigeria",
        "glyph": "🇳🇬",
        "keywords": [
          "NG",
          "flag"
        ],
        "aliases": [
          "flag_ng"
        ]
      },
      {
        "shortcode": "nicaragua",
        "glyph": "🇳🇮",
        "keywords": [
          "NI",
          "flag"
        ],
        "aliases": [
          "flag_ni"
        ]
      },
      {
        "shortcode": "netherlands",
        "glyph": "🇳🇱",
        "keywords": [
          "NL",
          "flag"
        ],
        "aliases": [
          "flag_nl"
        ]
      },
      {
        "shortcode": "norway",
        "glyph": "🇳🇴",
        "keywords": [
          "NO",
          "flag"
        ],
        "aliases": [
          "flag_no"
        ]
      },
      {
        "shortcode": "nepal",
        "glyph": "🇳🇵",
        "keywords": [
          "NP",
          "flag"
        ],
        "aliases": [
          "flag_np"
        ]
      },
      {
        "shortcode": "nauru",
        "glyph": "🇳🇷",
        "keywords": [
          "NR",
          "flag"
        ],
        "aliases": [
          "flag_nr"
        ]
      },
      {
        "shortcode": "niue",
        "glyph": "🇳🇺",
        "keywords": [
          "NU",
          "flag"
        ],
        "aliases": [
          "flag_nu"
        ]
      },
      {
        "shortcode": "new_zealand",
        "glyph": "🇳🇿",
        "keywords": [
          "NZ",
          "flag"
        ],
        "aliases": [
          "flag_nz"
        ]
      },
      {
        "shortcode": "oman",
        "glyph": "🇴🇲",
        "keywords": [
          "OM",
          "flag"
        ],
        "aliases": [
          "flag_om"
        ]
      },
      {
        "shortcode": "panama",
        "glyph": "🇵🇦",
        "keywords": [
          "PA",
          "flag"
        ],
        "aliases": [
          "flag_pa"
        ]
      },
      {
        "shortcode": "peru",
        "glyph": "🇵🇪",
        "keywords": [
          "PE",
          "flag"
        ],
        "aliases": [
          "flag_pe"
        ]
      },
      {
        "shortcode": "french_polynesia",
        "glyph": "🇵🇫",
        "keywords": [
          "PF",
          "flag"
        ],
        "aliases": [
          "flag_pf"
        ]
      },
      {
        "shortcode": "papua_new_guinea",
        "glyph": "🇵🇬",
        "keywords": [
          "PG",
          "flag"
        ],
        "aliases": [
          "flag_pg"
        ]
      },
      {
        "shortcode": "philippines",
        "glyph": "🇵🇭",
        "keywords": [
          "PH",
          "flag"
        ],
        "aliases": [
          "flag_ph"
        ]
      },
      {
        "shortcode": "pakistan",
        "glyph": "🇵🇰",
        "keywords": [
          "PK",
          "flag"
        ],
        "aliases": [
          "flag_pk"
        ]
      },
      {
        "shortcode": "poland",
        "glyph": "🇵🇱",
        "keywords": [
          "PL",
          "flag"
        ],
        "aliases": [
          "flag_pl"
        ]
      },
      {
        "shortcode": "st_pierre_miquelon",
        "glyph": "🇵🇲",
        "keywords": [
          "PM",
          "flag"
        ],
        "aliases": [
          "flag_pm"
        ]
      },
      {
        "shortcode": "pitcairn_islands",
        "glyph": "🇵🇳",
        "keywords": [
          "PN",
          "flag"
        ],
        "aliases": [
          "flag_pn"
        ]
      },
      {
        "shortcode": "puerto_rico",
        "glyph": "🇵🇷",
        "keywords": [
          "PR",
          "flag"
        ],
        "aliases": [
          "flag_pr"
        ]
      },
      {
        "shortcode": "palestinian_territories",
        "glyph": "🇵🇸",
        "keywords": [
          "PS",
          "flag"
        ],
        "aliases": [
          "flag_ps"
        ]
      },
      {
        "shortcode": "portugal",
        "glyph": "🇵🇹",
        "keywords": [
          "PT",
          "flag"
        ],
        "aliases": [
          "flag_pt"
        ]
      },
      {
        "shortcode": "palau",
        "glyph": "🇵🇼",
        "keywords": [
          "PW",
          "flag"
        ],
        "aliases": [
          "flag_pw"
        ]
      },
      {
        "shortcode": "paraguay",
        "glyph": "🇵🇾",
        "keywords": [
          "PY",
          "flag"
        ],
        "aliases": [
          "flag_py"
        ]
      },
      {
        "shortcode": "qatar",
        "glyph": "🇶🇦",
        "keywords": [
          "QA",
          "flag"
        ],
        "aliases": [
          "flag_qa"
        ]
      },
      {
        "shortcode": "reunion",
        "glyph": "🇷🇪",
        "keywords": [
          "RE",
          "flag"
        ],
        "aliases": [
          "flag_re"
        ]
      },
      {
        "shortcode": "romania",
        "glyph": "🇷🇴",
        "keywords": [
          "RO",
          "flag"
        ],
        "aliases": [
          "flag_ro"
        ]
      },
      {
        "shortcode": "serbia",
        "glyph": "🇷🇸",
        "keywords": [
          "RS",
          "flag"
        ],
        "aliases": [
          "flag_rs"
        ]
      },
      {
        "shortcode": "ru",
        "glyph": "🇷🇺",
        "keywords": [
          "RU",
          "flag"
        ],
        "aliases": [
          "flag_ru",
          "russia"
        ]
      },
      {
        "shortcode": "rwanda",
        "glyph": "🇷🇼",
        "keywords": [
          "RW",
          "flag"
        ],
        "aliases": [
          "flag_rw"
        ]
      },
      {
        "shortcode": "saudi_arabia",
        "glyph": "🇸🇦",
        "keywords": [
          "SA",
          "flag"
        ],
        "aliases": [
          "flag_sa"
        ]
      },
      {
        "shortcode": "solomon_islands",
        "glyph": "🇸🇧",
        "keywords": [
          "SB",
          "flag"
        ],
        "aliases": [
          "flag_sb"
        ]
      },
      {
        "shortcode": "seychelles",
        "glyph": "🇸🇨",
        "keywords": [
          "SC",
          "flag"
        ],
        "aliases": [
          "flag_sc"
        ]
      },
      {
        "shortcode": "sudan",
        "glyph": "🇸🇩",
        "keywords": [
          "SD",
          "flag"
        ],
        "aliases": [
          "flag_sd"
        ]
      },
      {
        "shortcode": "sweden",
        "glyph": "🇸🇪",
        "keywords": [
          "SE",
          "flag"
        ],
        "aliases": [
          "flag_se"
        ]
      },
      {
        "shortcode": "singapore",
        "glyph": "🇸🇬",
        "keywords": [
          "SG",
          "flag"
        ],
        "aliases": [
          "flag_sg"
        ]
      },
      {
        "shortcode": "st_helena",
        "glyph": "🇸🇭",
        "keywords": [
          "SH",
          "flag"
        ],
        "aliases": [
          "flag_sh"
        ]
      },
      {
        "shortcode": "slovenia",
        "glyph": "🇸🇮",
        "keywords": [
          "SI",
          "flag"
        ],
        "aliases": [
          "flag_si"
        ]
      },
      {
        "shortcode": "svalbard_jan_mayen",
        "glyph": "🇸🇯",
        "keywords": [
          "SJ",
          "flag"
        ],
        "aliases": [
          "flag_sj"
        ]
      },
      {
        "shortcode": "slovakia",
        "glyph": "🇸🇰",
        "keywords": [
          "SK",
          "flag"
        ],
        "aliases": [
          "flag_sk"
        ]
      },
      {
        "shortcode": "sierra_leone",
        "glyph": "🇸🇱",
        "keywords": [
          "SL",
          "flag"
        ],
        "aliases": [
          "flag_sl"
        ]
      },
      {
        "shortcode": "san_marino",
        "glyph": "🇸🇲",
        "keywords": [
          "SM",
          "flag"
        ],
        "aliases": [
          "flag_sm"
        ]
      },
      {
        "shortcode": "senegal",
        "glyph": "🇸🇳",
        "keywords": [
          "SN",
          "flag"
        ],
        "aliases": [
          "flag_sn"
        ]
      },
      {
        "shortcode": "somalia",
        "glyph": "🇸🇴",
        "keywords": [
          "SO",
          "flag"
        ],
        "aliases": [
          "flag_so"
        ]
      },
      {
        "shortcode": "suriname",
        "glyph": "🇸🇷",
        "keywords": [
          "SR",
          "flag"
        ],
        "aliases": [
          "flag_sr"
        ]
      },
      {
        "shortcode": "south_sudan",
        "glyph": "🇸🇸",
        "keywords": [
          "SS",
          "flag"
        ],
        "aliases": [
          "flag_ss"
        ]
      },
      {
        "shortcode": "sao_tome_principe",
        "glyph": "🇸🇹",
        "keywords": [
          "ST",
          "flag"
        ],
        "aliases": [
          "flag_st"
        ]
      },
      {
        "shortcode": "el_salvador",
        "glyph": "🇸🇻",
        "keywords": [
          "SV",
          "flag"
        ],
        "aliases": [
          "flag_sv"
        ]
      },
      {
        "shortcode": "sint_maarten",
        "glyph": "🇸🇽",
        "keywords": [
          "SX",
          "flag"
        ],
        "aliases": [
          "flag_sx"
        ]
      },
      {
        "shortcode": "syria",
        "glyph": "🇸🇾",
        "keywords": [
          "SY",
          "flag"
        ],
        "aliases": [
          "flag_sy"
        ]
      },
      {
        "shortcode": "swaziland",
        "glyph": "🇸🇿",
        "keywords": [
          "SZ",
          "flag"
        ],
        "aliases": [
          "eswatini",
          "flag_sz"
        ]
      },
      {
        "shortcode": "tristan_da_cunha",
        "glyph": "🇹🇦",
        "keywords": [
          "TA",
          "flag"
        ],
        "aliases": [
          "flag_ta"
        ]
      },
      {
        "shortcode": "turks_caicos_islands",
        "glyph": "🇹🇨",
        "keywords": [
          "TC",
          "flag"
        ],
        "aliases": [
          "flag_tc"
        ]
      },
      {
        "shortcode": "chad",
        "glyph": "🇹🇩",
        "keywords": [
          "TD",
          "flag"
        ],
        "aliases": [
          "flag_td"
        ]
      },
      {
        "shortcode": "french_southern_territories",
        "glyph": "🇹🇫",
        "keywords": [
          "TF",
          "flag"
        ],
        "aliases": [
          "flag_tf"
        ]
      },
      {
        "shortcode": "togo",
        "glyph": "🇹🇬",
        "keywords": [
          "TG",
          "flag"
        ],
        "aliases": [
          "flag_tg"
        ]
      },
      {
        "shortcode": "thailand",
        "glyph": "🇹🇭",
        "keywords": [
          "TH",
          "flag"
        ],
        "aliases": [
          "flag_th"
        ]
      },
      {
        "shortcode": "tajikistan",
        "glyph": "🇹🇯",
        "keywords": [
          "TJ",
          "flag"
        ],
        "aliases": [
          "flag_tj"
        ]
      },
      {
        "shortcode": "tokelau",
        "glyph": "🇹🇰",
        "keywords": [
          "TK",
          "flag"
        ],
        "aliases": [
          "flag_tk"
        ]
      },
      {
        "shortcode": "timor_leste",
        "glyph": "🇹🇱",
        "keywords": [
          "TL",
          "flag"
        ],
        "aliases": [
          "flag_tl"
        ]
      },
      {
        "shortcode": "turkmenistan",
        "glyph": "🇹🇲",
        "keywords": [
          "TM",
          "flag"
        ],
        "aliases": [
          "flag_tm"
        ]
      },
      {
        "shortcode": "tunisia",
        "glyph": "🇹🇳",
        "keywords": [
          "TN",
          "flag"
        ],
        "aliases": [
          "flag_tn"
        ]
      },
      {
        "shortcode": "tonga",
        "glyph": "🇹🇴",
        "keywords": [
          "TO",
          "flag"
        ],
        "aliases": [
          "flag_to"
        ]
      },
      {
        "shortcode": "tr",
        "glyph": "🇹🇷",
        "keywords": [
          "TR",
          "flag"
        ],
        "aliases": [
          "flag_tr",
          "turkey_tr"
        ]
      },
      {
        "shortcode": "trinidad_tobago",
        "glyph": "🇹🇹",
        "keywords": [
          "TT",
          "flag"
        ],
        "aliases": [
          "flag_tt"
        ]
      },
      {
        "shortcode": "tuvalu",
        "glyph": "🇹🇻",
        "keywords": [
          "TV",
          "flag"
        ],
        "aliases": [
          "flag_tv"
        ]
      },
      {
        "shortcode": "taiwan",
        "glyph": "🇹🇼",
        "keywords": [
          "TW",
          "flag"
        ],
        "aliases": [
          "flag_tw"
        ]
      },
      {
        "shortcode": "tanzania",
        "glyph": "🇹🇿",
        "keywords": [
          "TZ",
          "flag"
        ],
        "aliases": [
          "flag_tz"
        ]
      },
      {
        "shortcode": "ukraine",
        "glyph": "🇺🇦",
        "keywords": [
          "UA",
          "flag"
        ],
        "aliases": [
          "flag_ua"
        ]
      },
      {
        "shortcode": "uganda",
        "glyph": "🇺🇬",
        "keywords": [
          "UG",
          "flag"
        ],
        "aliases": [
          "flag_ug"
        ]
      },
      {
        "shortcode": "us_outlying_islands",
        "glyph": "🇺🇲",
        "keywords": [
          "UM",
          "flag"
        ],
        "aliases": [
          "flag_um"
        ]
      },
      {
        "shortcode": "united_nations",
        "glyph": "🇺🇳",
        "keywords": [
          "UN",
          "flag"
        ],
        "aliases": [
          "flag_un",
          "un"
        ]
      },
      {
        "shortcode": "us",
        "glyph": "🇺🇸",
        "keywords": [
          "US",
          "flag"
        ],
        "aliases": [
          "flag_us",
          "united_states",
          "usa"
        ]
      },
      {
        "shortcode": "uruguay",
        "glyph": "🇺🇾",
        "keywords": [
          "UY",
          "flag"
        ],
        "aliases": [
          "flag_uy"
        ]
      },
      {
        "shortcode": "uzbekistan",
        "glyph": "🇺🇿",
        "keywords": [
          "UZ",
          "flag"
        ],
        "aliases": [
          "flag_uz"
        ]
      },
      {
        "shortcode": "vatican_city",
        "glyph": "🇻🇦",
        "keywords": [
          "VA",
          "flag"
        ],
        "aliases": [
          "flag_va"
        ]
      },
      {
        "shortcode": "st_vincent_grenadines",
        "glyph": "🇻🇨",
        "keywords": [
          "VC",
          "flag"
        ],
        "aliases": [
          "flag_vc"
        ]
      },
      {
        "shortcode": "venezuela",
        "glyph": "🇻🇪",
        "keywords": [
          "VE",
          "flag"
        ],
        "aliases": [
          "flag_ve"
        ]
      },
      {
        "shortcode": "british_virgin_islands",
        "glyph": "🇻🇬",
        "keywords": [
          "VG",
          "flag"
        ],
        "aliases": [
          "flag_vg"
        ]
      },
      {
        "shortcode": "us_virgin_islands",
        "glyph": "🇻🇮",
        "keywords": [
          "VI",
          "flag"
        ],
        "aliases": [
          "flag_vi"
        ]
      },
      {
        "shortcode": "vietnam",
        "glyph": "🇻🇳",
        "keywords": [
          "VN",
          "flag"
        ],
        "aliases": [
          "flag_vn"
        ]
      },
      {
        "shortcode": "vanuatu",
        "glyph": "🇻🇺",
        "keywords": [
          "VU",
          "flag"
        ],
        "aliases": [
          "flag_vu"
        ]
      },
      {
        "shortcode": "wallis_futuna",
        "glyph": "🇼🇫",
        "keywords": [
          "WF",
          "flag"
        ],
        "aliases": [
          "flag_wf"
        ]
      },
      {
        "shortcode": "samoa",
        "glyph": "🇼🇸",
        "keywords": [
          "WS",
          "flag"
        ],
        "aliases": [
          "flag_ws"
        ]
      },
      {
        "shortcode": "kosovo",
        "glyph": "🇽🇰",
        "keywords": [
          "XK",
          "flag"
        ],
        "aliases": [
          "flag_xk"
        ]
      },
      {
        "shortcode": "yemen",
        "glyph": "🇾🇪",
        "keywords": [
          "YE",
          "flag"
        ],
        "aliases": [
          "flag_ye"
        ]
      },
      {
        "shortcode": "mayotte",
        "glyph": "🇾🇹",
        "keywords": [
          "YT",
          "flag"
        ],
        "aliases": [
          "flag_yt"
        ]
      },
      {
        "shortcode": "south_africa",
        "glyph": "🇿🇦",
        "keywords": [
          "ZA",
          "flag"
        ],
        "aliases": [
          "flag_za"
        ]
      },
      {
        "shortcode": "zambia",
        "glyph": "🇿🇲",
        "keywords": [
          "ZM",
          "flag"
        ],
        "aliases": [
          "flag_zm"
        ]
      },
      {
        "shortcode": "zimbabwe",
        "glyph": "🇿🇼",
        "keywords": [
          "ZW",
          "flag"
        ],
        "aliases": [
          "flag_zw"
        ]
      },
      {
        "shortcode": "england",
        "glyph": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
        "keywords": [
          "flag",
          "gbeng"
        ],
        "aliases": [
          "flag_gbeng"
        ]
      },
      {
        "shortcode": "scotland",
        "glyph": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
        "keywords": [
          "flag",
          "gbsct"
        ],
        "aliases": [
          "flag_gbsct"
        ]
      },
      {
        "shortcode": "wales",
        "glyph": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
        "keywords": [
          "flag",
          "gbwls"
        ],
        "aliases": [
          "flag_gbwls"
        ]
      }
    ]
  }
];

/**
 * Flat list of all built-in emoji shortcodes (including aliases) — used for
 * shortcode autocomplete and outgoing shortcode expansion. The emoji picker
 * reads EMOJI_CATEGORIES through ui/emoji_catalog.ts instead.
 */
export const BUILTIN_EMOJI: ShortcodeEntry[] = EMOJI_CATEGORIES.flatMap((cat) =>
  cat.entries.flatMap((e) => [
    { key: e.glyph, shortcode: e.shortcode },
    ...(e.aliases ?? []).map((alias) => ({ key: e.glyph, shortcode: alias })),
  ]),
);
