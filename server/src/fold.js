// The key two people are matched on (email, username): folded to lower case for the ASCII letters ONLY. String.prototype.toLowerCase
// also folds characters like the Kelvin sign (U+212A) onto plain letters, so "K.smith@x.example" would match "k.smith@x.example" here
// even though PingOne may not treat them as the same account, and the lab would then add somebody else's account to the group.
// Not matching is the safe direction: the person is planned as a create, and a real duplicate comes back from PingOne as a conflict.
export const lower = (s) => String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
