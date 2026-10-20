export class HttpError extends Error{constructor(message:string,public status=400,public code?:string){super(message)}}
