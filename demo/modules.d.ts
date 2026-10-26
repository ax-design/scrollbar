// The demo imports its looks' style sheets as text.
declare module '*.css' {
    const text: string;
    export default text;
}
