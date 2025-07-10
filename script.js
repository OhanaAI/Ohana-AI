// script.js

// --- Engine ---
class OhanaAi {
    constructor(game) {
        this.game = game;
        this.pieceValues = {
            'p': 1,  // (pawn)
            'n': 3,  // (knight)
            'b': 3,  // (bishop)
            'r': 5,  // (rook)
            'q': 9,  // (queen)
            'k': 0   // (king)
        };

        // Gewichtungen
        this.CHECKMATE_LOSS_PENALTY = 99999;
        this.CHECK_PENALTY = 20;
        this.UNPROTECTED_LOSS_PENALTY = 1.0;
        this.PAWN_ADVANCE_PENALTY = 0.8;
        this.BAD_PAWN_MOVE_PENALTY = 2;
        this.KING_MOVE_PENALTY = 1;
        this.CASTLE_SHORT_BONUS = 1;
        this.KNIGHT_ON_EDGE_PENALTY = 0.8;
        this.FIANCHETTO_G7_BONUS = 0.6;
        this.DEVELOPMENT_BONUS = 0.3;

    }

    makeMove() {
        var possibleMoves = this.game.moves({ verbose: true }); // 'verbose' gibt detaillierte Zugobjekte
        if (possibleMoves.length === 0) {
            return null;
        }

        // Eröffnung
        if (this.game.turn() === 'b' && this.game.history().length < 2) { 
            const allowedOpeningMoves = ['b6', 'Nc6', 'c5', 'd6', 'd5', 'e6', 'e5', 'Nf6', 'g6'];
            possibleMoves = possibleMoves.filter(move => {
                // move.san ist die Standard-Algebra-Notation
                return allowedOpeningMoves.includes(move.san);
            });

            // Fallback
            if (possibleMoves.length === 0) {
                console.warn("Keine erlaubten Eröffnungszüge gefunden. Fällt auf zufälligen Zug zurück.");
                possibleMoves = this.game.moves({ verbose: true }); // Ursprüngliche Liste wiederherstellen
            }
        }

        var bestMove = null;
        var bestMoveValue = -Infinity;

        // moveValue errechnen
        for (var i = 0; i < possibleMoves.length; i++) {
            var move = possibleMoves[i];
            var moveValue = 0;

            // Nächsten Zug simulieren
            this.game.move(move);

            // Selbst-Matt vermeiden
            if (this.game.isCheckmate()) {
                moveValue -= this.CHECKMATE_LOSS_PENALTY;
            }

            // BEWERTUNG 0: Matt in 1 verhindern
            if (!this.game.isGameOver()) {
                var opponentMoves = this.game.moves({ verbose: true });
                for (var j = 0; j < opponentMoves.length; j++) {
                    var oppMove = opponentMoves[j];
                    this.game.move(oppMove); 
                    if (this.game.isCheckmate()) {
                        moveValue -= this.CHECKMATE_LOSS_PENALTY;
                        this.game.undo();
                        break; // Matt gefunden -> Schleife abbrechen
                    }
                    this.game.undo();
                }
            }

            // BEWERTUNG 1: Schlagzüge bevorzugen
            if (move.captured) {
                moveValue += this.pieceValues[move.captured] || 0;
            }

            // BEWERTUNG 2: Schach vermeiden
            if (this.game.inCheck()) { 
                moveValue -= this.CHECK_PENALTY;
            }

            // BEWERTUNG 3: Negativen Figur-Tausch vermeiden
            var opponentCaptures = this.game.moves({ verbose: true }).filter(m => m.captured);
            var worstNetLoss = 0; // Wir suchen den schlimmsten Netto-Verlust für diesen Zug

            for (var j = 0; j < opponentCaptures.length; j++) {
                var oppCaptureMove = opponentCaptures[j];
                this.game.move(oppCaptureMove); // Simuliere den Schlag des Gegners

                var lostPieceValue = this.pieceValues[oppCaptureMove.captured] || 0; // Wert der Figur, die wir verloren haben

                var highestRecaptureValue = 0; // Welchen Wert können wir höchstens zurückschlagen?
                var ourRecaptures = this.game.moves({ verbose: true }).filter(m => m.captured);

                for (var k = 0; k < ourRecaptures.length; k++) {
                    var ourRecaptureMove = ourRecaptures[k];
                    var recapturedPieceValue = this.pieceValues[ourRecaptureMove.captured] || 0;
                    if (recapturedPieceValue > highestRecaptureValue) {
                        highestRecaptureValue = recapturedPieceValue;
                    }
                }
                
                // Berechne den Netto-Verlust: Wert der verlorenen Figur - Wert der höchsten zurückgeschlagenen Figur
                var netLoss = lostPieceValue - highestRecaptureValue;

                // Wenn dieser Netto-Verlust schlimmer ist als der bisher schlimmste, aktualisiere
                if (netLoss > worstNetLoss) {
                    worstNetLoss = netLoss;
                }

                this.game.undo(); // WICHTIG: Gegenschlag des Gegners rückgängig machen
            }
            // Ziehe den Netto-Verlust vom MoveValue ab
            // Nur strafen, wenn es ein echter Verlust ist (netLoss > 0)
            if (worstNetLoss > 0) {
                 moveValue -= (worstNetLoss * this.UNPROTECTED_LOSS_PENALTY);
            }

            // BEWERTUNG 4: Negative Bewertung für vorrückende Bauernzüge ohne direkten Nutzen
            if (move.piece === 'p' && !move.captured) { // Nur Bauernzüge, die nicht schlagen
                var toRank = parseInt(move.to[1]);
                // Für OhanaAI ist die gegnerische Hälfte die Reihen 1-4
                if (this.game.turn() === 'w') {
                    if (toRank <= 4) { 
                        moveValue -= this.PAWN_ADVANCE_PENALTY;
                    }
                }
            }
            // BEWERTUNG 5: Negative Bewertung für Fortress bruch
            if (move.piece === 'p' && move.from === 'f7' && (move.to === 'f6' || move.to === 'f5')) {
                moveValue -= this.BAD_PAWN_MOVE_PENALTY;
            }
            if (move.piece === 'p' && (move.from === 'g7' || move.from === 'g6') && move.to === 'g5') {
                moveValue -= this.BAD_PAWN_MOVE_PENALTY;
            }

            // BEWERTUNG 6: Königssicherheit
            if (move.piece === 'k') {
                // 'flags' enthält Informationen über den Zugtyp
                if (move.flags !== 'k') {
                    moveValue -= this.KING_MOVE_PENALTY;
                }
            }

            // BEWERTUNG 7: Bonus für kurze Rochade
            if (move.flags === 'k') { 
                moveValue += this.CASTLE_SHORT_BONUS;
            }

            // BEWERTUNG 8: Springer am Rande, große Schande
            if (move.piece === 'n') {
                var toFile = move.to[0];
                if (toFile === 'a' || toFile === 'h') {
                    moveValue -= this.KNIGHT_ON_EDGE_PENALTY;
                }
            }
            
            // BEWERTUNG 9: Bonus für Fianchetto auf g7
            if (move.piece === 'b' && move.to === 'g7') {
                moveValue += this.FIANCHETTO_G7_BONUS;
            }

            // BEWERTUNG 10: Bonus für Figuren-Entwicklung
            if (move.piece === 'n' || move.piece === 'b') {
                var fromRank = parseInt(move.from[1]);
                var toRank = parseInt(move.to[1]);
                // Ideale Entwicklungsreihen sind 6 und 5.
                if ((fromRank === 7 || fromRank === 8) && (toRank === 6 || toRank === 5)) {
                    moveValue += this.DEVELOPMENT_BONUS;
                }
            }

            // Bei gleicher Bewertung zu variieren
            moveValue += Math.random() * 0.1;

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
}

// --- Wird ausgeführt, wenn das Dokument vollständig geladen ist ---
$(document).ready(function() {
    // Überprüfen ob die Chess-Klasse global verfügbar ist
    if (typeof Chess === 'undefined') {
        console.error("Fehler: Chess.js Bibliothek ist nicht geladen oder nicht global verfügbar.");
        alert("Kritischer Fehler: Schachlogik nicht verfügbar.");
        return;
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

    // 'game'-Instanz an die Engine übergeben
    window.computerEngine = new OhanaAi(game); 
    
    updateStatus();

    $('#resetButton').on('click', function() {
        resetGame();
    });

    $('#logo').on('click', function() {
        resetGame();
    });

    $(window).on('resize', function() {
        board.resize();
    });
});