// Plain CSS, as a string so that the published package needs no bundler plugin for it.
export default `/* Windows XP (Luna) kit, the markers: etched ticks, orange when hovered. Each tick is a 1px
   border over a 1px background (a hard-stop gradient would be antialiased at the stop). */
:host([axis="vertical"]) {
    box-sizing: border-box;
    width: 9px;
    height: 2px;
    border-top: 1px solid #aca899;
    background: #ffffff;
}
:host([axis="horizontal"]) {
    box-sizing: border-box;
    width: 2px;
    height: 9px;
    border-left: 1px solid #aca899;
    background: #ffffff;
}
:host([current]) { border-color: #716f64; background: #ffffff; }
:host([hover]) { border-color: #e59700; background: #ffc83c; }
:host([axis="vertical"][hover]) { width: 13px; }
/* Under the thumb a tick would cross the grip and read as a seam of the thumb, and the thumb already
   says where the reader is: ticks there show only while hovered. Last, so it wins over the above. */
:host([on-thumb]) { visibility: hidden; }
:host([on-thumb][hover]) { visibility: visible; }
:host([axis="horizontal"][hover]) { height: 13px; }
`;
