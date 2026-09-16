/* =====================================================================
   config.js — the only file you edit.

   baseUrl gets stuck on the front of every "file" path below, so you only
   write the bit that changes.

   Each episode can be written two ways:

     "Season 01/E01.mkv"                        <- just the path, auto-numbered
     { n: 1, title: "Name", file: "E01.mkv" }   <- with a title

   Mix them freely.
   ===================================================================== */

window.LIBRARY = {

  siteTitle: "mark's Anime Library",  // Appears in the browser tab and at the top of the page

  // Your NAS. Must be https:// or the browser will block it, because this
  // site is served over https. No trailing slash.
  baseUrl: "https://nas.yourdomain.com:5006/anime",

  series: [
    {
      title: "Example Series",
      poster: "",              // optional image URL; blank draws a cover instead
      episodes: [
        { n: 1, title: "The First Episode",  file: "Example Series/S01E01.mkv" },
        { n: 2, title: "The Second Episode", file: "Example Series/S01E02.mkv" },
        "Example Series/S01E03.mkv"
      ]
    },

    {
      title: "Another Series",
      poster: "",
      episodes: [
        "Another Series/E01.mkv",
        "Another Series/E02.mkv"
      ]
    }
  ]
};