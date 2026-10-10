/**
 * Messages sent to one person about their own account.
 *
 * **No password is ever in here, and that is deliberate.**
 *
 * The obvious version of "tell them their account was created" puts the
 * password in the email. It is also the wrong version: mail is stored
 * unencrypted on several machines nobody in this conversation controls, it is
 * backed up, it is searchable years later, and it is forwarded. A tool for
 * managing information security should not be the thing that leaves a working
 * credential sitting in an inbox.
 *
 * So the email says the account exists, where to find it, and what the username
 * is. The password still travels the way it should: said out loud, or through a
 * password manager, by the administrator who set it.
 *
 * One exception, chosen deliberately: an administrator who has forgotten their
 * password can have a temporary one emailed (temporaryPassword below). It is
 * not their password. It works once, for thirty minutes, and the only thing it
 * lets anyone do is choose a new password; their real one keeps working until
 * then. So what sits in the inbox afterwards is a spent, expired string.
 *
 * A second exception follows from the first: an invitation (invitation below).
 * An administrator can invite a new person instead of choosing a password for
 * them, so that nobody but the person ever knows theirs. The email carries a
 * one-time password that works once, for three days, and only opens the page
 * that chooses a real one. Nobody has seen it, including the administrator, and
 * once it has been used or has expired it is worthless.
 *
 * Nothing in this file throws. Creating a user must not fail because a mail
 * server is down, and resetting a password must not either.
 */
import { sendMail, type SendResult } from "./mailer.js";
import { config, product } from "../config.js";

export interface AccountPerson {
  name: string;
  username: string;
  email: string;
  role: string;
}

const signature = (): string =>
  `\n--\n${product.name}\n${config.PUBLIC_URL}\n`;

/**
 * Tells somebody an account has been made for them.
 *
 * Sent when an administrator adds a user, so the person hears it from the
 * product rather than only from whoever happened to mention it.
 */
export async function accountCreated(
  person: AccountPerson,
  createdBy: string,
): Promise<SendResult> {
  if (!person.email.trim()) return { sent: false, reason: "That user has no email address." };

  return sendMail({
    to: person.email,
    subject: `${product.name}: an account has been created for you`,
    text:
      `Hello ${person.name},\n\n` +
      `${createdBy} has created an account for you in ${product.name}, ` +
      `which is used to manage our ${product.framework} programme.\n\n` +
      `  Address:  ${config.PUBLIC_URL}\n` +
      `  Username: ${person.username}\n` +
      `  Role:     ${person.role}\n\n` +
      "Your password is not in this message, on purpose: email is not a safe " +
      "place to keep one. Ask " + createdBy + " for it directly.\n" +
      signature(),
  });
}

/**
 * Tells somebody their password was changed by an administrator.
 *
 * The point is not the convenience. It is that a person who did not ask for
 * this finds out it happened, which is the only way an account taken over by
 * somebody with administrator access gets noticed at all.
 */
export async function passwordChanged(
  person: AccountPerson,
  changedBy: string,
): Promise<SendResult> {
  if (!person.email.trim()) return { sent: false, reason: "That user has no email address." };

  return sendMail({
    to: person.email,
    subject: `${product.name}: your password was changed`,
    text:
      `Hello ${person.name},\n\n` +
      `${changedBy} has set a new password on your ${product.name} account ` +
      `(${person.username}).\n\n` +
      "The new password is not in this message. Ask them for it directly.\n\n" +
      "If you were not expecting this, tell whoever runs this system now. " +
      "An administrator changing a password without being asked is worth " +
      "questioning.\n" +
      signature(),
  });
}

/**
 * Sends an administrator a temporary password they asked for.
 *
 * Says where the request came from, so somebody who did not ask can see it
 * was not them, and says plainly that doing nothing is safe.
 */
export async function temporaryPassword(
  person: AccountPerson,
  temporary: string,
  minutes: number,
  requestedFrom: string | null,
): Promise<SendResult> {
  return sendMail({
    to: person.email,
    subject: `${product.name}: your temporary password`,
    text:
      `Hello ${person.name},\n\n` +
      `Somebody asked for a temporary password for your ${product.name} account` +
      (requestedFrom ? `, from ${requestedFrom}` : "") + ".\n\n" +
      `  Address:            ${config.PUBLIC_URL}\n` +
      `  Username:           ${person.username}\n` +
      `  Temporary password: ${temporary}\n\n` +
      `It works once, for ${minutes} minutes. Signing in with it takes you straight ` +
      "to a page where you choose a new password, and nothing else is available " +
      "until you do.\n\n" +
      "If you did not ask for this, you can ignore it. Your current password still " +
      "works, and this one expires on its own.\n" +
      signature(),
  });
}

/**
 * Invites somebody: their account exists, and here is how to choose a password.
 *
 * Unlike accountCreated, this one carries a password - a one-time password the
 * administrator never saw. See the note at the top of this file for why that is
 * acceptable here and nowhere else.
 */
export async function invitation(
  person: AccountPerson,
  temporary: string,
  hours: number,
  invitedBy: string,
): Promise<SendResult> {
  if (!person.email.trim()) return { sent: false, reason: "That user has no email address." };
  return sendMail({
    to: person.email,
    subject: `${product.name}: you have been invited`,
    text:
      `Hello ${person.name},\n\n` +
      `${invitedBy} has created an account for you in ${product.name}, ` +
      `which is used to manage our ${product.framework} programme.\n\n` +
      `  Address:            ${config.PUBLIC_URL}\n` +
      `  Username:           ${person.username}\n` +
      `  One-time password:  ${temporary}\n\n` +
      `Sign in with those. The password works once, for ${Math.round(hours / 24)} days, ` +
      "and takes you straight to a page where you choose your own password. " +
      "Nobody else will ever know it, including the person who invited you.\n\n" +
      "If you were not expecting this, you can ignore it: it expires on its own.\n" +
      signature(),
  });
}

/**
 * Tells somebody their own password was just changed.
 *
 * Sent after a change they made themselves, which is when it is least
 * interesting - except in the one case it matters: when it was not them.
 */
export async function ownPasswordChanged(person: AccountPerson): Promise<SendResult> {
  if (!person.email.trim()) return { sent: false, reason: "That user has no email address." };
  return sendMail({
    to: person.email,
    subject: `${product.name}: your password was changed`,
    text:
      `Hello ${person.name},\n\n` +
      `The password on your ${product.name} account (${person.username}) has just ` +
      "been changed, and every other place it was signed in has been signed out.\n\n" +
      "If that was you, there is nothing to do. If it was not, tell whoever runs " +
      "this system now.\n" +
      signature(),
  });
}
