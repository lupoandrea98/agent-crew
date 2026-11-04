# agent-crew

Pannello laterale per Claude Code che mostra il lavoro in corso: un Claude animato per il main agent e per ogni subagent, con modello e barra di avanzamento, l'albero del worktree (richiudibile cliccando sul titolo) con i file toccati evidenziati, le card dei file modificati a lavoro concluso e, in fondo a destra, le barre di utilizzo del piano (finestra 5h e settimanale) con il conto alla rovescia del reset.

Nel terminale gli sprite sono disegnati a mezzi blocchi (con ripiego ASCII), sull'app desktop in SVG.

## Uso

Il pannello si apre da solo all'avvio della sessione. Per riaprirlo: `/crew`.

Le barre di utilizzo compaiono solo con un abbonamento Claude (il motore non fornisce i limiti altrimenti) e dopo la prima risposta; fino ad allora si legge "n/d".

## Installazione

Dal prompt di una sessione nel terminale:

```
/plugin install agent-crew --marketplace lupoandrea98/agent-crew
```

Da una shell:

```
claude plugin install agent-crew --marketplace lupoandrea98/agent-crew
```

Nell'app desktop `/plugin` non è disponibile: clic su + accanto al prompt, poi Plugins, Add marketplace con `lupoandrea98/agent-crew`, quindi Add plugin.

Il repository è privato: funziona solo per chi è stato invitato su GitHub e ha già una credenziale git per github.com (una chiave SSH, oppure `gh auth login` seguito da `gh auth setup-git`).

## Sviluppo

```
claude --plugin-dir ./agent-crew
claude plugin validate agent-crew
```

## Licenza

MIT
