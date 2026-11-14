/** Tiny query helpers shared by every feature's data.js. */
const { q, tx } = require('../../db');

const one = async (sql, p) => (await q(sql, p)).rows[0] || null;
const many = async (sql, p) => (await q(sql, p)).rows;

module.exports = { q, tx, one, many };
