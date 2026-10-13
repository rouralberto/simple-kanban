import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

// WeKan (Meteor accounts-password) stores bcrypt(sha256hex(password)).
export function verifyPassword(password, hash, algo = 'bcrypt') {
  if (!hash) return false;
  const input = algo === 'meteor'
    ? crypto.createHash('sha256').update(password).digest('hex')
    : password;
  return bcrypt.compareSync(input, hash);
}
