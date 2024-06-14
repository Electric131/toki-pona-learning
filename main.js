const fs = require("fs");
const path = require("path");
const readline = require('readline');
const commandLineArgs = require('command-line-args');

// Setup a keypress listener
readline.emitKeypressEvents(process.stdin);
process.stdin.on('keypress', async (ch, key) => {
    if (!key) return; // Edge case
    if (key.ctrl && key.name == "c") {
        process.stdin.pause();
        console.log("Exiting due to ctrl+c interrupt");
        process.exit(1);
    }
    awaitingResolution.forEach(res => res(key)); // Resolve all waiting keypress listeners
    awaitingResolution = [];
});

var awaitingResolution = [];
function keyPressed() {
    return new Promise((res, rej) => {
        awaitingResolution.push(res);
    })
}

process.stdin.setRawMode(true);
process.stdin.resume();

const options = [
    { name: "practice", alias: "p", type: Boolean, default: false },    // Skip straight to practice - bypass main menu
    { name: "kitz", type: Boolean, default: false },                    // Easteregg for kitzurea - Just a different alias to `practice`
    { name: "help", alias: "h", type: Boolean, default: false},         // Ignore all other argumens, and show the list of arguments
    { name: "words", alias: "W", type: Boolean, default: false },       // Skip straight to learned words - bypass main menu
    { name: "stats", alias: "S", type: Boolean, default: false },       // Skip straight to statistics - bypass main menu
    { name: "word-rate", alias: "w", type: Number, default: 5 },        // Override config for how many new words are given at a time
    { name: "min-accuracy", alias: "a", type: Number, default: 80 },    // Override config for how often new words are given
    { name: "count", alias: "c", type: Number }                         // Sets the amount of words to practice in practice mode
]

console.log("Parsing arguments..");
const args = commandLineArgs(options);
// Merge `kitz` arg with practice, since it's just another alias
args.practice = args.practice || args.kitz;
delete args.kitz;
args["word-rate"] = args["word-rate"] || 5; // Enforce default
args["min-accuracy"] = args["min-accuracy"] || 80; // Enforce default

var progress = {};
var config = {};
console.log("Parsing progress file..");
fs.readFile(path.join(__dirname, "progress.json"), (err, data) => {
    if (err) console.error(err);
    try {
        progress = JSON.parse(data.toString());
    } catch {
        console.error("Failed to load progress");
    }
    if (Object.entries(progress).length == 0) {
        console.log("Resetting progress..");
        progress = {
            rarity: {
                core: {
                    enabled: true, // Controls if this rarity type is allowed to be shown
                    weight: 100 // Weightthat a word of this rarity will be shown
                },
                common: {
                    enabled: true,
                    weight: 0
                },
                uncommon: {
                    enabled: true,
                    weight: 0
                },
                obscure: {
                    enabled: false,
                    weight: 0
                }
            },
            words: {}
        }
    }
    saveProgress();
    console.log("Parsing config file..");
    fs.readFile(path.join(__dirname, "config.json"), (err, data) => {
        if (err) console.error(err);
        try {
            config = JSON.parse(data.toString());
        } catch {
            console.error("Failed to load config");
        }
        if (Object.entries(config).length == 0) {
            console.log("Resetting config..");
            config = {
                practice: {
                    showPronunciation: true,
                    showAccuracy: true,
                    multipleChoiceChance: 0.70
                }
            }
            fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(config, null, 4));
        }
        main();
    });
});

// Called after progress file is loaded
function main() {
    if (args.help) {
        console.clear();
        console.log(`Available parameters:
    help (h) - Shows this list
    practice (p) - Skip to practice mode
    words (W) - Skip to list of learned words
    stats (S) - Skip to statistics
    word-rate (w) <number over 0> - Override how many new words are given
    min-accuracy (a) <number 0-100> - Accuracy required (in percent) to be given new words
    count (c) - Number of words given in practice mode before exiting`);
    } else if (args.practice) {
        practice();
    } else if (args.words) {
        printWords();
    } else if (args.stats) {
        statistics();
    } else {
        console.clear();
        select(["Practice", "Learned Words", "Statistics", "Exit"]).then(choice => {
            console.clear();
            switch (choice) {
                case "Practice":
                    practice();
                    break;
                case "Learned Words":
                    printWords();
                    break;
                case "Statistics":
                    statistics();
                    break;
                case "Exit":
                    process.exit(0); // Exit with sucess code
            }
        });
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const saveProgress = () => fs.writeFileSync(path.join(__dirname, "progress.json"), JSON.stringify(progress, null, 4));

var words;
function loadWords() {
    return new Promise(async (mres, mrej) => { // prefix m for main
        if (words) mres();
        console.log("Fetching word list..");
        fetch("https://api.linku.la/v1/words").then(res => {
            res.text().then(text => {
                words = Object.values(JSON.parse(text));
                mres();
            });
        });
    });
}
function practice() {
    loadWords().then(loop); // Load words and then enter loop
}
function printWords() {
    console.clear();
    console.log(`Learned Words (${Object.keys(progress.words).length}):`);
    let sorted = Object.keys(progress.words).sort((a, b) => {
        a = progress.words[a];
        b = progress.words[b];
        let aAccuracy = (a.correct / a.attempts) || 0;
        let bAccuracy = (b.correct / b.attempts) || 0;
        return bAccuracy - aAccuracy;
    });
    for (let word of sorted) {
        let wordData = progress.words[word];
        let percent = Math.round(((wordData.correct / wordData.attempts) || 0) * 10000) / 100;
        console.log(`${word} (${percent}%) - ${wordData.attempts} attempts`);
    }
}
async function statistics() {
    await loadWords();
    console.clear();
    console.log("Statistics:")
    console.log(`Total learned words: ${Object.keys(progress.words).length}`);
    console.log(`Learned core words: ${filter("core").length}`);
    console.log(`Learned common words: ${filter("common").length}`);
    console.log(`Learned uncommon words: ${filter("uncommon").length}`);
    console.log(`Learned obscure words: ${filter("obscure").length}`);
}

const define = (wordData) => wordData.translations["en"].definition;
function pronounce (wordData)  {
    let replacements = {
        "a": "ah",
        "e": "eh",
        "i": "ee",
        "o": "oh",
        "u": "oo",
        "j": "y"
    }
    // God forbidden RegEx to find syllables
    let syllables = wordData.word.matchAll(/[ptkmnlswj]?(?:(?<=w)[aei]|(?<=[jt])[aeou]|(?<=[pkmnls])[aeiou]|(?<=\b)[aeiou])(?:n(?![nm]?[aeiou]))?/g);
    let finalSyllables = [];
    for (const syllable of syllables) {
        let replaced = "";
        for (const letter of syllable.toString().split("")) {
            replaced += replacements[letter] || letter;
        }
        finalSyllables.push(replaced);
    }
    if (finalSyllables.length == 0) {
        if (wordData.word == "wuwojiti") return "No";
        return wordData.word; // Fallback
    }
    return finalSyllables.join("-");
}
function pickRarity() {
    let filtered = Object.keys(progress.rarity).filter(val => progress.rarity[val].enabled);
    let sum = 0;
    filtered.forEach(name => sum += progress.rarity[name].weight);
    let chosen = Math.floor(Math.random() * sum);
    sum = 0; // Reset sum to count up
    for (const name of filtered) {
        if (chosen <= sum + progress.rarity[name].weight) {
            return name
        }
    }
}
function pickWord() {
    let rarity = pickRarity();
    let filtered = weighted(filter(rarity));
    while (filtered.length == 0) {
        pickNewWords();
        filtered = weighted(filter(rarity));
    }
    let chosen = filtered[Math.floor(Math.random() * filtered.length)];
    return chosen;
}
function pickNewWords() { // Adds new words to the current list
    let rarity = pickRarity();
    for (i=0; i<args["word-rate"]; i++) {
        let filtered = words.filter(val => !Object.keys(progress.words).includes(val.word)); // Filter by words in the list
        filtered = filtered.filter(val => val.usage_category == rarity); // Filter by rarity
        if (filtered.length == 0) break;
        let chosen = filtered[Math.floor(Math.random() * filtered.length)];
        progress.words[chosen.word] = {
            attempts: 0, // Amount of times this word has been attempted
            correct: 0 // Amount of times this word was correctly answered
        };
    }
    saveProgress();
}
function filter(rarity) {
    return words.filter(val => // Filter by available words and correct rarity
        Object.keys(progress.words).includes(val.word) &&
        val.usage_category == rarity
    );
};
function weighted(original) {
    let final = [];
    let addNewWords = true;
    for (const word of original) {
        let correctPercent = progress.words[word.word].correct / progress.words[word.word].attempts; // Correct guesses / Total guesses
        let weight = 5;
        if (progress.words[word.word].attempts >= 5) {
            if (correctPercent >= 0.8) {
                weight -= Math.round(Math.floor((correctPercent - 0.79) * 20));
            } else {
                weight += Math.round(correctPercent * 20);
            }
        }
        if (!(progress.words[word.word].attempts >= 5 && correctPercent >= args["min-accuracy"] / 100)) { // If every word has 5 attempts and x% accuracy, add new words
            addNewWords = false;
        }
        final = final.concat(new Array(weight).fill(word)); // Repeat this word `weight` times
    }
    if (addNewWords) final = []; // Forces new words to be added
    return final;
}
async function select(choices, customDraw) {
    let choice = 0;
    while (true) {
        console.clear();
        if (customDraw) customDraw(); // Option to add additional text. ex. title
        console.log("Use up/down arrows or W/S to change selection and Enter to select.");
        for (const i in choices) {
            console.log(`${i == choice ? ">" : " "} ${choices[i]}`);
        };
        let key = await keyPressed();
        switch (key.name) {
            case "return":
                return choices[choice];
            case "w":
            case "up":
                if (choice > 0) choice--;
                break;
            case "s":
            case "down":
                if (choice < choices.length - 1) choice++;
                break;
        }
    }
}
function question(prompt) {
    return new Promise(async (res, rej) => {
        let answer = "";
        while (true) {
            process.stdout.write("\r\x1b[K"); // Clear previous line
            process.stdout.write(prompt + answer);
            let key = await keyPressed();
            if (/^[a-z]$/g.exec(key.name)) {
                answer += key.name;
            } else if (key.name == "backspace" && answer.length > 0) {
                answer = answer.slice(0, -1);
            } else if (key.name == "return" || key.sequence == "?") {
                process.stdout.write("\n");
                if (key.sequence == "?") {
                    answer += "?";
                }
                res(answer);
                break;
            }
        }
    });
}
// Thanks stack overflow
function shuffle(array) {
    let currentIndex = array.length;
    // While there remain elements to shuffle...
    while (currentIndex != 0) {
        // Pick a remaining element...
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
}

async function loop() {
    let sessionCount = 0;
    while (true) {
        let word = pickWord();
        let hint = "";
        let skipped = false;
        progress.words[word.word].attempts++;
        let type = Math.random();
        let filtered = Object.keys(progress.words).filter(val => progress.words[val].attempts >= 3 && val != word.word);
        while (true) {
            console.clear();
            if (filtered.length >= 5 && progress.words[word.word].attempts >= 5 && type < config.practice.multipleChoiceChance) {
                // Give a multiple choice question
                let options = [define(word)];
                for (i=0; i<3; i++) { // Pick 3 random words
                    let chosen = filtered[Math.floor(Math.random() * filtered.length)];
                    filtered.splice(filtered.indexOf(chosen), 1); // Pop word out of the list
                    options.push(define(words.filter(val => val.word == chosen)[0])); // Convert word to it's definition
                }
                shuffle(options);
                let answer = await select(options, () => {
                    console.log(`Word: ${word.word}`);
                });
                if (answer == define(word)) {
                    progress.words[word.word].correct++;
                    console.log(`Correct!   ${word.word}: ${define(word)}`);
                } else {
                    console.log(`Incorrect! ${word.word}: ${define(word)}`);
                }
                break;
            } else {
                // Give a typing question
                console.log("Type 'skip' to skip this word, or '?' for a hint. (These do not take given hints into account)");
                console.log(`Definition: ${define(word)}`);
                if (progress.words[word.word].attempts == 1) {
                    console.log(`New Word! - ${word.word}`);
                }
                if (skipped) {
                    console.log(`Word: ${word.word}`);
                    break;
                }
                let guess = await question(`Word: ${hint}`);
                if (hint + guess == word.word) {
                    progress.words[word.word].correct++;
                    break;
                }
                if (guess == 'skip') skipped = true;
                if (guess.includes('?') && word.word.length - hint.length > 0) {
                    let guessSplit = (hint + guess).split("");
                    guessSplit.pop();
                    for (const i in guessSplit) {
                        if (guessSplit[i] != word.word.split("")[i]) break;
                        if (word.word.length - hint.length <= 0) break;
                        if (hint.length <= i) hint += word.word.slice(hint.length)[0];
                    }
                    if (word.word.length - hint.length > 0) hint += word.word.slice(hint.length)[0];
                    if (hint == word.word) skipped = true;
                } else {
                    let guessSplit = (hint + guess).split("");
                    for (const i in guessSplit) {
                        if (guessSplit[i] != word.word.split("")[i]) break;
                        if (word.word.length - hint.length <= 0) break;
                        if (hint.length <= i) hint += word.word.slice(hint.length)[0];
                    }
                }
            }
        }
        if (config.practice.showPronunciation) console.log(`Pronunciation: ${pronounce(word)}`);
        if (config.practice.showAccuracy) console.log(`Accuracy: ${Math.round((progress.words[word.word].correct / progress.words[word.word].attempts) * 10000) / 100}%`);
        sessionCount++;
        saveProgress();
        await delay(1000);
        if (args.count <= sessionCount) {
            console.log("Session over!");
            process.exit(0);
        }
    }
}
