# agent-crew

Pannello laterale per Claude Code in stile videogioco fantasy 8-bit che mostra il lavoro in corso: un eroe animato per il main agent (il mago, con cappello e bastone magico) e per ogni subagent (cavaliere, ladro, re, arciere, chierico, barbaro), con modello e barra di avanzamento, l'albero del worktree (richiudibile cliccando sul titolo) con i file toccati evidenziati e le card dei file modificati a lavoro concluso.

Sopra la barra di scrittura c'è un HUD con tre barre: **Vita** (rossa, finestra di utilizzo settimanale), **Mana** (blu, finestra delle 5 ore) e **Vigore** (verde, il contesto della sessione); Vita e Mana mostrano il conto alla rovescia del reset. Le barre sono piene quando la risorsa è disponibile e si svuotano man mano che la usi. L'HUD si adatta alla larghezza senza mai andare a capo: prima spariscono le etichette, poi il conto alla rovescia, infine la fascia cede il posto.

Nel terminale sprite e icone sono disegnati a mezzi blocchi (con ripiego ASCII), sull'app desktop in SVG.

## Uso

Il pannello si apre da solo all'avvio della sessione. Per riaprirlo: `/crew`. L'HUD sopra il prompt è indipendente dal pannello e resta visibile anche se lo chiudi.

Vita e Mana compaiono solo con un abbonamento Claude (il motore non fornisce i limiti altrimenti) e dopo la prima risposta; fino ad allora si legge "n/d". Anche il Vigore mostra "n/d" in una sessione nuova o appena compattata.

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
claude plugin test agent-crew
```

## Licenza

MIT
