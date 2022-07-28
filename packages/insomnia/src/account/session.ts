import * as srp from 'srp-js';

import * as crypt from './crypt';
import * as fetch from './fetch';

type LoginCallback = (isLoggedIn: boolean) => void;

export interface WhoamiResponse {
  sessionAge: number;
  accountId: string;
  email: string;
  firstName: string;
  lastName: string;
  created: number;
  publicKey: string;
  encSymmetricKey: string;
  encPrivateKey: string;
  saltEnc: string;
  isPaymentRequired: boolean;
  isTrialing: boolean;
  isVerified: boolean;
  isAdmin: boolean;
  trialEnd: string;
  planName: string;
  planId: string;
  canManageTeams: boolean;
  maxTeamMembers: number;
}

export interface SessionData {
  accountId: string;
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  symmetricKey: JsonWebKey;
  publicKey: JsonWebKey;
  encPrivateKey: crypt.AESMessage;
}

const loginCallbacks: LoginCallback[] = [];

function _callCallbacks() {
  const loggedIn = isLoggedIn();
  console.log('[session] Sync state changed loggedIn=' + loggedIn);

  for (const cb of loginCallbacks) {
    if (typeof cb === 'function') {
      cb(loggedIn);
    }
  }
}

export function onLoginLogout(loginCallback: LoginCallback) {
  loginCallbacks.push(loginCallback);
}

/** Creates a session from a sessionId and derived symmetric key. */
export async function absorbKey(sessionId: string, key: string) {
  // Get and store some extra info (salts and keys)
  const {
    publicKey,
    encPrivateKey,
    encSymmetricKey,
    email,
    accountId,
    firstName,
    lastName,
  } = await _whoami(sessionId);
  const symmetricKeyStr = crypt.decryptAES(key, JSON.parse(encSymmetricKey));
  // Store the information for later
  setSessionData(
    sessionId,
    accountId,
    firstName,
    lastName,
    email,
    JSON.parse(symmetricKeyStr),
    JSON.parse(publicKey),
    JSON.parse(encPrivateKey),
  );

  _callCallbacks();
}

export async function changePasswordWithToken(rawNewPassphrase: string, confirmationCode: string) {
  // Sanitize inputs
  const newPassphrase = _sanitizePassphrase(rawNewPassphrase);

  const newEmail = getEmail(); // Use the same one

  if (!newEmail) {
    throw new Error('Session e-mail unexpectedly not set');
  }

  // Fetch some things
  const { saltEnc, encSymmetricKey } = await _whoami();
  const { saltKey, saltAuth } = await _getAuthSalts(newEmail);
  // Generate some secrets for the user based on password
  const newSecret = await crypt.deriveKey(newPassphrase, newEmail, saltEnc);
  const newAuthSecret = await crypt.deriveKey(newPassphrase, newEmail, saltKey);
  const newVerifier = srp
    .computeVerifier(
      _getSrpParams(),
      Buffer.from(saltAuth, 'hex'),
      Buffer.from(newEmail || '', 'utf8'),
      Buffer.from(newAuthSecret, 'hex'),
    )
    .toString('hex');
  // Re-encrypt existing keys with new secret
  const symmetricKey = JSON.stringify(_getSymmetricKey());
  const newEncSymmetricKeyJSON = crypt.encryptAES(newSecret, symmetricKey);
  const newEncSymmetricKey = JSON.stringify(newEncSymmetricKeyJSON);
  return fetch.post(
    '/auth/change-password',
    {
      code: confirmationCode,
      newEmail: newEmail,
      encSymmetricKey: encSymmetricKey,
      newVerifier,
      newEncSymmetricKey,
    },
    getCurrentSessionId(),
  );
}

export function sendPasswordChangeCode() {
  return fetch.post('/auth/send-password-code', null, getCurrentSessionId());
}

export function getPublicKey() {
  return _getSessionData()?.publicKey;
}

export function getPrivateKey() {
  const sessionData = _getSessionData();

  if (!sessionData) {
    throw new Error("Can't get private key: session is blank.");
  }

  const { symmetricKey, encPrivateKey } = sessionData;

  if (!symmetricKey || !encPrivateKey) {
    throw new Error("Can't get private key: session is missing keys.");
  }

  const privateKeyStr = crypt.decryptAES(symmetricKey, encPrivateKey);
  return JSON.parse(privateKeyStr);
}

export function getCurrentSessionId() {
  if (window) {
    return window.localStorage.getItem('currentSessionId');
  } else {
    return '';
  }
}

export function getAccountId() {
  return _getSessionData()?.accountId;
}

export function getEmail() {
  return _getSessionData()?.email;
}

export function getFirstName() {
  return _getSessionData()?.firstName;
}

export function getLastName() {
  return _getSessionData()?.lastName;
}

export function getFullName() {
  return `${getFirstName()} ${getLastName()}`.trim();
}

/** Check if we (think) we have a session */
export function isLoggedIn() {
  return !!getCurrentSessionId();
}

/** Log out and delete session data */
export async function logout() {
  try {
    await fetch.post('/auth/logout', null, getCurrentSessionId());
  } catch (error) {
    // Not a huge deal if this fails, but we don't want it to prevent the
    // user from signing out.
    console.warn('Failed to logout', error);
  }

  _unsetSessionData();

  _callCallbacks();
}

/** Set data for the new session and store it encrypted with the sessionId */
export function setSessionData(
  sessionId: string,
  accountId: string,
  firstName: string,
  lastName: string,
  email: string,
  symmetricKey: JsonWebKey,
  publicKey: JsonWebKey,
  encPrivateKey: crypt.AESMessage,
) {
  const sessionData: SessionData = {
    id: sessionId,
    accountId: accountId,
    symmetricKey: symmetricKey,
    publicKey: publicKey,
    encPrivateKey: encPrivateKey,
    email: email,
    firstName: firstName,
    lastName: lastName,
  };
  const dataStr = JSON.stringify(sessionData);
  window.localStorage.setItem(_getSessionKey(sessionId), dataStr);
  // NOTE: We're setting this last because the stuff above might fail
  window.localStorage.setItem('currentSessionId', sessionId);
}
export async function listTeams() {
  return fetch.get('/api/teams', getCurrentSessionId());
}

// ~~~~~~~~~~~~~~~~ //
// Helper Functions //
// ~~~~~~~~~~~~~~~~ //
function _getSymmetricKey() {
  return _getSessionData()?.symmetricKey;
}

function _whoami(sessionId: string | null = null): Promise<WhoamiResponse> {
  return fetch.getJson<WhoamiResponse>('/auth/whoami', sessionId || getCurrentSessionId());
}

function _getAuthSalts(email: string) {
  return fetch.post(
    '/auth/login-s',
    {
      email,
    },
    getCurrentSessionId(),
  );
}

const _getSessionData = (): Partial<SessionData> | null => {
  const sessionId = getCurrentSessionId();

  if (!sessionId || !window) {
    return {};
  }

  const dataStr = window.localStorage.getItem(_getSessionKey(sessionId));
  if (dataStr === null) {
    return null;
  }
  return JSON.parse(dataStr) as SessionData;
};

function _unsetSessionData() {
  const sessionId = getCurrentSessionId();
  window.localStorage.removeItem(_getSessionKey(sessionId));
  window.localStorage.removeItem('currentSessionId');
}

function _getSessionKey(sessionId: string | null) {
  return `session__${(sessionId || '').slice(0, 10)}`;
}

function _getSrpParams() {
  return srp.params[2048];
}

function _sanitizePassphrase(passphrase: string) {
  return passphrase.trim().normalize('NFKD');
}
