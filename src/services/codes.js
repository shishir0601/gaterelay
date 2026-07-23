"use strict";

function fourDigitCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Generates a pickup/delivery code pair guaranteed not to collide with each other. */
function generateHandoffCodes() {
  const pickupCode = fourDigitCode();
  let deliveryCode = fourDigitCode();
  while (deliveryCode === pickupCode) deliveryCode = fourDigitCode();
  return { pickupCode, deliveryCode };
}

module.exports = { fourDigitCode, generateHandoffCodes };
