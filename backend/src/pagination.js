"use strict";
const { page } = require("./validation");
async function collection(
  db,
  req,
  res,
  { select, count, params = [], key = "items" },
) {
  const p = page(req.query);
  const [[total]] = await db.query(count, params);
  const [items] = await db.query(select + " LIMIT ? OFFSET ?", [
    ...params,
    p.limit,
    p.offset,
  ]);
  res.json({
    [key]: items,
    pagination: {
      page: p.number,
      limit: p.limit,
      total: Number(total.total),
      pages: Math.max(1, Math.ceil(total.total / p.limit)),
    },
  });
}
module.exports = { collection };
