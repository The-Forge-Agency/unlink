// Liens affichés dans l'extension (page d'accueil, réglages). Un lien vide n'est pas affiché.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  UL.LINKS = {
    authorName: 'Vassili Joffroy',
    authorLinkedin: 'https://www.linkedin.com/in/vassili-joffroy/',
    agencyName: 'The Forge Agency',
    agencyUrl: 'https://the-forge.agency/',
    coffee: 'https://buymeacoffee.com/tfa.the.forge.agency',
    repo: 'https://github.com/The-Forge-Agency/unlink',
  };
})();
