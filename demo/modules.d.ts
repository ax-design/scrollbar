// The demo imports its kit's style sheet as text.
declare module '*.css' {
    const text: string;
    export default text;
}
