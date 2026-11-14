// JSON API routes. Delete this file if the feature has none. See src/core/router.js.
module.exports = function routes(route, kit) {
  const { requireUser, httpError } = kit;
  const data = require('./data');

  route('GET', '/api/my-feature/hello', async ({ req, res, url }) => {
    const user = await requireUser(req, res);
    const name = url.searchParams.get('name');
    if (name && name.length > 40) throw httpError(400, 'Name is too long');
    return { hello: name || user.displayName, count: await data.countThings(user.id) };
  });
};
