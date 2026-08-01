/**
 * npm-check-updates configuration.
 *
 * TypeScript is held to its current major; the 7.x migration is deferred.
 * Minor and patch updates still apply.
 */
module.exports = {
  target: (name) => (name === 'typescript' ? 'minor' : 'latest'),
};
