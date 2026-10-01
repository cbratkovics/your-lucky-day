export async function resolve(specifier, context, next) {
  if (specifier === "@devvit/web/server") return { url: new URL("./fake-devvit.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
