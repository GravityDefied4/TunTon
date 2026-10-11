const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client();

/* Verifies signature, expiry, issuer and audience of a Google ID token.
   Returns the trusted profile, or throws. */
async function verifyGoogleCredential(credential) {
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID
  });
  const p = ticket.getPayload();
  if (!p.email || !p.email_verified) throw new Error('Google email is not verified');
  return {
    google_sub: p.sub,
    email: p.email.toLowerCase(),
    full_name: p.name || p.email,
    given_name: p.given_name || (p.name || p.email).split(' ')[0],
    picture: p.picture || null
  };
}

module.exports = { verifyGoogleCredential };
