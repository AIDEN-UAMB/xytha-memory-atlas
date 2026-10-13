import {pathToFileURL} from 'node:url';

export async function resolve(specifier,context,nextResolve){
  const portable=/^[A-Za-z]:[\\/]/u.test(specifier)?pathToFileURL(specifier).href:specifier;
  return nextResolve(portable,context);
}

