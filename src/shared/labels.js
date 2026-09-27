// Tous les « points d'accroche » sur le DOM de LinkedIn sont ici.
// Si LinkedIn change son interface, c'est (normalement) le seul fichier à retoucher.
// Les motifs texte s'appliquent à du texte normalisé : minuscules, sans accents, apostrophes droites.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});

  UL.L = {
    // Bouton « Plus » / « More » de l'en-tête du profil
    moreActions: /^(more actions|more|plus d'actions|plus|plus d'options|autres actions|weitere aktionen|mehr|mas acciones|mas|altre azioni|altro)$/,
    // Élément de menu / bouton « Ne plus suivre »
    unfollow: /(unfollow|ne plus suivre|se desabonner|arreter de suivre|stop following|nicht mehr folgen|entfolgen|dejar de seguir|deixar de seguir|smetti di seguire|non seguire piu|niet meer volgen|ontvolgen)/,
    // Texte « Suivi(e) » / « Following » : bouton ou entrée de menu qui arrête le suivi quand on clique dessus
    followingText: /^(following|suivi|suivie|abonne|abonnee|abonnement|gefolgt|folge ich|siguiendo|seguindo|segui gia|volgend)$/,
    // Entrée « Suivre » : preuve que le désabonnement a bien eu lieu
    follow: /^(follow|suivre|folgen|seguir|segui|volgen)$/,
    // Élément de menu « Retirer la relation »
    removeConnection: /((remove|retirer|supprimer|eliminar|remover|rimuovi|verwijderen).{0,30}(connection|connexion|relation|kontakt|contacto|conexao|collegamento|connectie))|((kontakt|verbindung|connectie|connection).{0,30}(entfernen|loschen|verwijderen))/,
    // Menu de la conversation
    threadOptions: /(option|more actions|plus d'actions|autres actions)/,
    // LinkedIn FR dit « Supprimer la discussion » (sept. 2026)
    deleteConversation: /((delete|supprimer|eliminar|excluir|elimina|verwijder).{0,25}(conversation|discussion|chat|thread|conversacion|conversa|conversazione|gesprek))|((konversation|unterhaltung|chat|gesprek).{0,25}(loschen|verwijderen))/,
    archiveConversation: /^(?!.*(unarchive|desarchiv|dearchiv|desarquiv|ripristina)).*(archive|archiver|archivieren|archivar|arquivar|archivia|archiveren)/,
    // Boutons des boîtes de dialogue de confirmation
    confirm: /^(delete|supprimer|remove|retirer|unfollow|ne plus suivre|confirm|confirmer|loschen|entfernen|eliminar|excluir|remover|elimina|rimuovi|verwijderen)\b/,
    // Texte attendu dans la fenêtre de confirmation d'une suppression de discussion / d'un retrait de relation
    deleteDialog: /(supprimer|delete|loschen|eliminar|excluir|elimina|verwijder)/,
    removeDialog: /(supprimer|retirer|remove|entfernen|eliminar|remover|rimuovi|verwijder)/,
    cancel: /^(cancel|annuler|non|no|abbrechen|cancelar|annulla|dismiss|ignorer|fermer|close)\b/,
    // Aperçu d'une conversation dont le dernier message est le nôtre (« Vous : … »)
    mePrefix: /^(vous|you|sie|usted|voce|tu)\s*:/,
    company: /\/(company|school|showcase)\//,
    // Bouton en bas de la liste qui charge les conversations suivantes
    loadMore: /(charger plus|load more|afficher plus|show more|voir plus|mehr laden|cargar mas)/,
  };

  UL.SEL = {
    list: '.msg-conversations-container__conversations-list',
    listItem: 'li.msg-conversation-listitem, li.msg-conversations-container__convo-item',
    itemName: '.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names',
    itemSnippet: '.msg-conversation-card__message-snippet, .msg-conversation-card__message-snippet-body, .msg-conversation-listitem__message-snippet',
    itemUnread: '.msg-conversation-card__unread-count, .notification-badge__count',
    // Cible du clic pour ouvrir une conversation depuis la liste, par ordre de préférence
    itemLink: ['a[href*="/messaging/thread/"]', '.msg-conversation-listitem__link', '.msg-conversation-card__content--selectable', '[tabindex="0"]'],
    threadPane: '.msg-thread, .msg-convo-wrapper, .scaffold-layout__detail',
    // Le même bouton « … » existe sur chaque conversation de la liste : on vise celui de l'en-tête du fil ouvert.
    threadHeader: '.msg-title-bar, .msg-thread__topcard, .shared-title-bar',
    threadOptions: '.msg-thread-actions__control, button[class*="thread-actions__control"]',
    threadTitle: '.msg-entity-lockup__entity-title, .msg-thread__link-to-profile, .msg-title-bar h2, h2',
    messageList: '.msg-s-message-list, .msg-s-message-list-container, .msg-form, form',
    messageEvent: '.msg-s-message-list__event',
    anyMessage: '.msg-s-event-listitem',
    otherMessage: 'msg-s-event-listitem--other',
    dialogs: '[role="alertdialog"], .artdeco-modal, [role="dialog"]',
    menus: '[role="menu"], .artdeco-dropdown__content--is-open, .artdeco-dropdown__content[aria-hidden="false"], [data-popper-placement], [data-radix-popper-content-wrapper]',
    overlay: '[class*="msg-overlay"]',
    clickable: 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], .artdeco-dropdown__item',
  };
})();
