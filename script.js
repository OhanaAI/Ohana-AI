// script.js

// --- Engine ---
// Diese Engine nutzt die eingebaute Funktionalität von chess.js für Züge.
class SimpleChessJsEngine {
    constructor(game) {
        this.game = game;
        this.pieceValues = {
            'p': 1,  // Bauer (pawn)
            'n': 3,  // Springer (knight)
            'b': 3,  // Läufer (bishop)
            'r': 5,  // Turm (rook)
            'q': 9,  // Dame (queen)
            'k': 0   // König (kein Wert beim Schlagen, da Spielende)
        };
        this.CHECK_PENALTY = 10;
        this.LOSS_PENALTY_MULTIPLIER = 1.2;
        this.PAWN_ADVANCE_PENALTY = 0.5;
        this.F_PAWN_MOVE_PENALTY = 2;

    }

    makeMove() {
        var possibleMoves = this.game.moves({ verbose: true }); // 'verbose: true' gibt detaillierte Zugobjekte zurück
        if (possibleMoves.length === 0) {
            return null; // Kein Zug möglich
        }
        var bestMove = null;
        var bestMoveValue = -Infinity;

        // moveValue errechnen
        for (var i = 0; i < possibleMoves.length; i++) {
            var move = possibleMoves[i];
            var moveValue = 0;

            // Nächsten Zug simulieren
            this.game.move(move); 

            // BEWERTUNG 1: Schlagzüge bevorzugen
            if (move.captured) { // Wenn ein Feld 'captured' enthält, ist es ein Schlagzug
                moveValue += this.pieceValues[move.captured] || 0;
            }
            // BEWERTUNG 2: Eigenes Schach vermeiden (höchste Priorität!)
            if (this.game.inCheck()) { 
                moveValue -= this.CHECK_PENALTY;
            }
            // BEWERTUNG 3: Verlust eigener Figuren vermeiden
            // Hole alle möglichen Züge des Gegners (nach unserem simulierten Zug)
            var opponentMoves = this.game.moves({ verbose: true });
            var worstLossForThisMove = 0;

            for (var j = 0; j < opponentMoves.length; j++) {
                var oppMove = opponentMoves[j];
                // Wenn der gegnerische Zug eine unserer Figuren schlägt
                if (oppMove.captured) {
                    // Der 'captured' Wert ist die Figur, die der Gegner schlägt.
                    // Diese Figur gehört Ohana
                    var lostPieceValue = this.pieceValues[oppMove.captured] || 0;
                    // Wir wollen den maximalen Verlust für diesen Zug des Computers berücksichtigen
                    if (lostPieceValue > worstLossForThisMove) {
                        worstLossForThisMove = lostPieceValue;
                    }
                }
            }

            // Ziehe den Wert des schlimmsten Verlusts ab, multipliziert mit einem Faktor
            moveValue -= (worstLossForThisMove * this.LOSS_PENALTY_MULTIPLIER);

            // NEU: BEWERTUNG 4: Negative Bewertung für vorrückende Bauernzüge ohne direkten Nutzen
            if (move.piece === 'p' && !move.captured) { // Nur Bauernzüge, die nicht schlagen
                var toRank = parseInt(move.to[1]); // Die Reihe des Zielfeldes
                // Für Schwarz (Computer) ist die gegnerische Hälfte die Reihen 1-4
                if (this.game.turn() === 'w') { // Wenn nach dem Zug Weiß dran wäre, hat der schwarze Bauer seine Reihe erreicht
                                                // Sprich, der schwarze Bauer ist auf Reihe 4, 3, 2 oder 1
                    if (toRank <= 4) { 
                        moveValue -= this.PAWN_ADVANCE_PENALTY;
                    }
                }
            }

            // NEU: BEWERTUNG 5: Negative Bewertung für den f-Bauer Zug
            // Für Schwarz ist der f-Bauer von f7 nach f6 oder f5
            if (move.piece === 'p' && move.from === 'f7' && (move.to === 'f6' || move.to === 'f5')) {
                moveValue -= this.F_PAWN_MOVE_PENALTY;
            }

            // Füge eine kleine Zufallszahl hinzu, um bei gleicher Bewertung zu variieren
            moveValue += Math.random() * 0.1; // Fügt 0 bis 0.1 hinzu

            // Wenn dieser Zug besser ist als der bisher beste, update bestMove
            if (moveValue > bestMoveValue) {
                bestMoveValue = moveValue;
                bestMove = move;
            }
            this.game.undo();
        }
        
        // Ausgewählten Zug ausführen
        this.game.move(bestMove);
        return bestMove;
    }
}
// --- Ende der Engine ---

// vars
var board = null;
var game = new Chess();     // Initialisiert ein neues Schachspiel
var $status = $('#status'); // Referenz auf das HTML-Element für den Status
var $fen = $('#fen');       // Nicht verwendet, aber oft nützlich für Debugging
var $pgn = $('#pgn');       // Nicht verwendet, aber oft nützlich für Debugging

// --- Funktion, die aufgerufen wird, wenn ein Stück gezogen wird ---
function onDragStart (source, piece, position, orientation) {
    // Erlaube das Ziehen nur, wenn das Spiel nicht vorbei ist
    // und nur für die Figur der aktuellen Farbe
    if (game.isGameOver() === true ||
        (game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
}

// --- Funktion, die aufgerufen wird, wenn ein Stück losgelassen wird ---
function onDrop (source, target) {
    var move = null; // Deklariere move außerhalb des try-Blocks

    // NEUE LOGIK: Versuche den Zug im try-Block
    try {
        move = game.move({
            from: source,
            to: target,
            promotion: 'q' // Immer 'Dame' für die Promotion
        });
    } catch (error) {
        // Zug war ungültig -> 'snapback' zurück
        // console.warn("Ungültiger Zug", error);
        return 'snapback';
    }

    // Falls der Zug 'null' sein sollte aus irgendeinem Grund
    if (move === null) {
        return 'snapback';
    }

    // Wenn der Zug legal war, prüfe den Spielstatus
    updateStatus();

    // Computerzug nach dem menschlichen Zug
    if (!game.isGameOver()) {
        window.setTimeout(makeComputerMove, 250);
    }
}

// --- Funktion, die aufgerufen wird, wenn der Snap-Animation endet ---
function onSnapEnd () {
    board.position(game.fen()); // Sorgt dafür, dass die Figuren auf den korrekten Feldern einrasten
}

// --- Funktion für den Computerzug (extern) ---
function makeComputerMove() {
    // Sicherstellen, dass der Computer wirklich am Zug ist
    if (game.turn() === 'b') { // Computer ist Schwarz
        window.computerEngine.makeMove(); // Lass die Engine den Zug machen
        board.position(game.fen()); // Aktualisiere das Brett nach dem Computerzug
        updateStatus(); // Aktualisiere den Spielstatus
    }
}

// --- Funktion zur Aktualisierung des Spielstatus ---
function updateStatus () {
    var status = '';
    var moveColor = 'Weiß';
    var gameIsOver = false;

    // Farbe des gefährdeten Königs
    var kingColor = '';
    if (game.turn() === 'b') {
        moveColor = 'Schwarz';
        kingColor = 'b'; // Königfarbe Schwarz
    } else {
        kingColor = 'w'; // Königfarbe Weiß
    }

    // Entfernt alle 'highlight-check' und 'highlight-checkmate' Klassen vom Brett
    $('#myBoard .highlight-check, #myBoard .highlight-checkmate').removeClass('highlight-check highlight-checkmate');

    // --- Finde das Feld des Königs ---
    function findKingSquare(color) {
        const board = game.board(); // Holt das aktuelle Brett als 8x8 Array
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = board[i][j];
                if (piece && piece.type === 'k' && piece.color === color) {
                    // Wandle die Array-Koordinaten (i, j) in Schachnotation um
                    // i ist Reihe (0-7), j ist Spalte (0-7)
                    // Zeilen: 7-0 (8-1), Spalten: a-h
                    const file = String.fromCharCode(97 + j); // 97 ist 'a'
                    const rank = 8 - i;
                    return file + rank;
                }
            }
        }
        return null; // König nicht gefunden (sollte nicht passieren)
    }

    // Schachmatt
    if (game.isCheckmate()) {
        if (moveColor == 'Schwarz') {
            status = 'Du hast gewonnen!';
        }
        else {
            status = 'Schachmatt.';
        }
        gameIsOver = true;
        var kingSquare = findKingSquare(kingColor);
        if (kingSquare) {
            console.log("Matt auf", kingSquare);
            setTimeout(() => {
                $('#myBoard .square-' + kingSquare).addClass('highlight-checkmate');
            }, 10); // Verzögerung, um DOM-Update abzuwarten
        }
    }
    // Patt
    else if (game.isDraw()) {
        status = 'Remis.';
        gameIsOver = true;
    }
    // Normaler Spielzug
    else {
        if (moveColor == 'Weiß') {
            status = 'Du bist am Zug';
        }
        else {
            status = 'Ohana grübelt';
        }
        // Schach
        if (game.isCheck()) {
            /* status += ', ' + moveColor + ' steht im Schach'; */
            // Highlight für König im Schach setzen
            var kingSquare = findKingSquare(kingColor); 
            if (kingSquare) {
                console.log("Schach auf", kingSquare);
                setTimeout(() => {
                    $('#myBoard .square-' + kingSquare).addClass('highlight-check');
                }, 10); // Verzögerung, um DOM-Update abzuwarten
            }
        }
    }

    $('#status').html(status);

    if (gameIsOver) {
        $('#resetButton').addClass('show'); // Zeige Reset-Button wenn Spiel vorbei
    } else {
        $('#resetButton').removeClass('show'); // Verstecke ihn sonst
    }
}
// Alles zurücksetzen
function resetGame() {
    game.reset(); // Setzt chess.js Objekt auf die Startposition zurück
    board.position('start'); // Setzt das Schachbrett auf die Startposition zurück
    updateStatus();
    $('#resetButton').removeClass('show');
    console.log("Neues Spiel gestartet!");
}

// --- Wird ausgeführt, wenn das Dokument vollständig geladen ist ---
$(document).ready(function() {
    // Überprüfen ob die Chess-Klasse global verfügbar ist
    if (typeof Chess === 'undefined') {
        console.error("Fehler: Chess.js Bibliothek ist nicht geladen oder nicht global verfügbar.");
        alert("Kritischer Fehler: Schachlogik nicht verfügbar.");
        return; // Stoppe die Ausführung, wenn Chess nicht gefunden ist
    }

    // Konfiguration für das Schachbrett
    var config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        width: '100%',
        resize: true,
        touchSupport: true
    };
    board = Chessboard('myBoard', config);

    // Debug optionen:
    // console.log("Game object before engine init:", game); 
    // console.log("Is game an instance of Chess?", game instanceof Chess);

    // 'game'-Instanz an die Engine übergeben
    window.computerEngine = new SimpleChessJsEngine(game); 
    
    updateStatus(); // Initialen Status setzen, wenn das Spiel startet

    $('#resetButton').on('click', function() {
        resetGame(); // Rufe Reset-Funktion auf
    });

    $(window).on('resize', function() {
        board.resize();
    });
});