const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

async function send_otp_email(recipient_email, otp) {
  const recipient = recipient_email || ''
  const code = otp || ''

  if (!recipient || !code) {
    return
  }

  if (!process.env.SMTP_USER) {
    console.log('OTP for', recipient, 'is', code)
    return
  }

  const from_email = process.env.EMAIL_FROM || process.env.SMTP_USER

  const text_lines = [
    'Your AgriQual verification code is: ' + code,
    '',
    'This code will expire in 10 minutes.',
    '',
    'If you did not request this code, you can ignore this email.'
  ]

  const mail_options = {
    from: from_email,
    to: recipient,
    subject: 'Your AgriQual verification code',
    text: text_lines.join('\n')
  }

  await transporter.sendMail(mail_options)
}

async function send_help_email(payload) {
  const subject_raw = payload && payload.subject ? payload.subject : ''
  const message_raw = payload && payload.message ? payload.message : ''
  const user_email_raw = payload && payload.userEmail ? payload.userEmail : ''

  const subject = String(subject_raw)
  const message = String(message_raw)
  const user_email = String(user_email_raw || '').trim()

  const to_email = '26100370@lums.edu.pk'

  if (!process.env.SMTP_USER) {
    console.log('Help email (not actually sent). To:', to_email)
    console.log('From user:', user_email || 'Unknown user')
    console.log('Subject:', subject)
    console.log('Message:', message)
    return
  }

  const from_email = process.env.EMAIL_FROM || process.env.SMTP_USER
  const final_subject = '[AgriQual Help] ' + subject

  const body_lines = [
    'New help request from: ' + (user_email || 'Unknown user'),
    '',
    'Subject: ' + subject,
    '',
    'Message:',
    message
  ]

  const mail_options = {
    from: from_email,
    to: to_email,
    subject: final_subject,
    text: body_lines.join('\n')
  }

  await transporter.sendMail(mail_options)
}

async function send_password_change_email(recipient_email) {
  const recipient = recipient_email || ''
  if (!recipient) {
    return
  }

  if (!process.env.SMTP_USER) {
    console.log('Password change notification (not actually sent). To:', recipient)
    return
  }

  const from_email = process.env.EMAIL_FROM || process.env.SMTP_USER

  const lines = [
    'Hello,',
    '',
    'This is a confirmation that the password for your AgriQual account was changed.',
    '',
    'If you made this change, no further action is needed.',
    'If you did NOT change your password, please reset it immediately and contact support.',
    '',
    'This email was sent automatically. Please do not reply.'
  ]

  const mail_options = {
    from: from_email,
    to: recipient,
    subject: 'Your AgriQual password was changed',
    text: lines.join('\n')
  }

  await transporter.sendMail(mail_options)
}

module.exports = {
  send_otp_email,
  send_help_email,
  send_password_change_email
}
