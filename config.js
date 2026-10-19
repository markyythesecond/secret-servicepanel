/* =====================================================================
   config.js — site settings.

   HOW TO ADD VIDEOS
   -----------------
   1. On GitHub, open the `videos` folder in this repo.
   2. "Add file" -> "Upload files" -> drop your .mp4 / .webm / .mov files.
   3. Commit. The site picks them up automatically in about a minute.

   Optional extras:
   - Put videos in a subfolder (videos/Funny/clip.mp4) and "Funny" becomes
     a category button on the site.
   - Want a custom thumbnail? Upload an image with the SAME name next to
     the video:  videos/clip.mp4  +  videos/clip.jpg   (jpg, png or webp)
     Otherwise the site grabs a frame from the video automatically.
   - The file name becomes the title: "my_cool-clip.mp4" -> "my cool clip".

   GitHub limits: 25 MB per file when uploading in the browser,
   100 MB per file with git. Use .mp4 (H.264) for the best compatibility.
   ===================================================================== */

window.SITE = {
  title: "Secret Service Panel",
  tagline: "Classified footage. Authorized eyes only.",

  github: {
    owner:  "markyythesecond",
    repo:   "secret-servicepanel",
    branch: "main",
    folder: "videos"
  },

  // Default look. Visitors can switch with the theme button.
  // Options: "classified", "neon", "crimson", "terminal", "daylight"
  theme: "classified",

  // Sound effects on by default? Visitors can mute with the speaker button.
  sfx: true
};
