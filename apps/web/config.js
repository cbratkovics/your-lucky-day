// @ts-check
/** Site-level constants. Edit these; nothing else in the client needs to change. */
export const CONFIG = {
  siteName: "Your Lucky Day",
  // Appended to the share text.
  site: "yourluckyday.fyi",
  // Polar checkout link for the one-time charm pack. Set the checkout's success URL to
  //   https://yourluckyday.fyi/?checkout_id={CHECKOUT_ID}
  polarCheckoutUrl: "https://buy.polar.sh/polar_cl_hl1WU4fRsBsGvN0ikNcQTnXnkAcWxlxKg8ilu3oPCy1",
  charmPackPrice: "$9",
  // Used only when the API is unreachable (opening index.html from disk): a clearly
  // labelled preview so the page is never blank.
  previewSalt: "preview-only-not-secret",
  makerName: "Chris Bratkovics",
  makerUrl: "https://cbratkovics.dev",
};
