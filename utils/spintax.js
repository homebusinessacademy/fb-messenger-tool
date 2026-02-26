/**
 * Spintax parser — handles {a|b|c} syntax and {{first_name}} substitution
 */

import { MESSAGE_VARIATIONS } from '../messages.js';

/**
 * Parse spintax and return a random variation
 * {option1|option2|option3} → random pick
 */
export function spinText(template) {
  const spintaxPattern = /\{([^{}]+\|[^{}]+)\}/g;
  return template.replace(spintaxPattern, (match, options) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)].trim();
  });
}

/**
 * Apply a message variation with first_name substitution
 * @param {number} variationIndex - 0-4
 * @param {string} firstName - Friend's first name
 * @returns {string} - Final rendered message
 */
export function applyMessage(variationIndex, firstName) {
  const template = MESSAGE_VARIATIONS[variationIndex] || MESSAGE_VARIATIONS[0];
  const spun = spinText(template);
  return spun.replace(/\{\{first_name\}\}/g, firstName);
}
