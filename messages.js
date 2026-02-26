/**
 * Paul's 5 invitation message variations with spintax
 * Each variation produces 8-27 unique combinations
 * Total unique messages across all 5: 100+
 */

export const MESSAGE_VARIATIONS = [
  // Variation 1
  "Hey {{first_name}}, hope you're having a {great|wonderful|fantastic} day! Quick question. I recently {ran across|came across|found} a {project|business project|business model} that looks like it could be pretty {lucrative|profitable}. Would you be open to {taking a peek|checking it out|taking a look}? No worries {if not|if it's not for you}, just let me know.",

  // Variation 2
  "Hey {{first_name}}, hope you're doing well. This might not be for you, but you came to mind when I saw it, so {wanted to touch base|thought I'd reach out} just in case. It's an online {marketing|business} project, different from anything I've seen before, and looks like it could be a pretty {solid money maker|good income stream|great cash flow generator}. Does that sound like something you'd be open to {taking a look at|checking out}?",

  // Variation 3
  "Hi {{first_name}}, hope {all is well in your world|everything's going great|life is treating you well}. 🙂 I just {found|came across} something that made me think of you. It's an online business that's pretty {unique|different|one of a kind}. Honestly, I've never seen anything quite like it. Anyway, it looks like it could have some pretty {good|solid|great} potential so I wanted to reach out to see if you'd be open to taking a look?",

  // Variation 4
  "Hey {{first_name}}, hope you're having an {awesome|amazing|great} day! I just {saw|came across|found} a very unique {business project|project|business model} that made me think of you. {Who knows, maybe I'm crazy|Maybe it's a long shot}, but wanted to reach out just in case. Are you open to {checking out|exploring|looking at} any ways to {generate income|make money|create income} outside of what you're currently doing?",

  // Variation 5
  "Hey {{first_name}}, hope {all is good|everything's great|you're doing well}! {Random question|Quick question}. I just saw something that I'm pretty {excited|pumped} about. It's a business {project|model} that's {quite|pretty} unique. Wondering if you might be open to taking a look? No worries if not, just let me know. {Love to hear what you've been up to these days too|Would love to catch up too}!"
];

/**
 * Get a random variation index different from the last one used
 */
export function getRandomVariationIndex(lastIndex = null) {
  const indices = [0, 1, 2, 3, 4];
  if (lastIndex !== null) {
    const filtered = indices.filter(i => i !== lastIndex);
    return filtered[Math.floor(Math.random() * filtered.length)];
  }
  return Math.floor(Math.random() * indices.length);
}

export function getVariation(index) {
  return MESSAGE_VARIATIONS[index] || MESSAGE_VARIATIONS[0];
}
