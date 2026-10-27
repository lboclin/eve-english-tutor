// Planted mistakes for the comparison test. Say each one naturally while talking about the topic;
// tick it on the page if the model corrected it. Same list for every model.
export const TOPICS = [
  "Introduce yourself: age, where you live, how long you've lived there.",
  "What you did yesterday and last weekend.",
  "A problem at work and how someone helped you.",
  "Your opinion on remote work vs the office.",
];

export const PLANTED = [
  { id: "age", say: "I have 25 years.", fix: "I'm 25.", kind: "grammar" },
  { id: "people-is", say: "People is very friendly here.", fix: "People are…", kind: "grammar" },
  { id: "since", say: "I'm living here since 2020.", fix: "I've been living here since 2020.", kind: "grammar" },
  { id: "yesterday-go", say: "Yesterday I go to the gym.", fix: "Yesterday I went…", kind: "grammar" },
  { id: "didnt-went", say: "I didn't went to the party.", fix: "I didn't go…", kind: "grammar" },
  { id: "explained-me", say: "My colleague explained me the problem.", fix: "explained the problem to me", kind: "grammar" },
  { id: "make-question", say: "I needed to make a question to my boss.", fix: "ask a question", kind: "collocation" },
  { id: "depends-of", say: "It depends of the company.", fix: "depends on", kind: "collocation" },
  { id: "im-agree", say: "I'm agree that remote work is better.", fix: "I agree", kind: "grammar" },
  { id: "th", say: "I tink (think) it's more productive.", fix: "/θ/ in 'think'", kind: "pronunciation" },
  { id: "comfortable", say: "com-FOR-ta-ble (comfortable)", fix: "COMF-tə-bəl", kind: "pronunciation" },
  { id: "develop", say: "DE-ve-lop (develop)", fix: "de-VEL-op", kind: "pronunciation" },
];
