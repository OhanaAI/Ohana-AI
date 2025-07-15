// script.js

// --- Engine ---
class OhanaAi {
    constructor(game) {
        this.game = game;

        // Gewichtungen
        this.pieceValues = {
            'p': 100,
            'n': 300,
            'b': 300,
            'r': 500,
            'q': 900,
            'k': 0
        };

        this.CHECKMATE_LOSS_PENALTY = 100000;
        this.CHECK_PENALTY = 30;
        this.UNPROTECTED_LOSS_PENALTY = 10;
        this.PAWN_ADVANCE_PENALTY = 1;
        this.BAD_PAWN_MOVE_PENALTY = 50;
        this.KING_MOVE_PENALTY = 20;
        this.CASTLE_SHORT_BONUS = 90;
        this.CASTLE_LONG_BONUS = 70;
        this.FIANCHETTO_G7_BONUS = 20;
        this.DEVELOPMENT_BONUS = 30;
        this.QUEEN_EARLY_MOVE_PENALTY = 50;

        this.PAWN_TABLE = [
            0,  0,  0,  0,  0,  0,  0,  0,
            50, 50, 50, 50, 50, 50, 50, 50,
            10, 10, 20, 30, 30, 20, 10, 10,
            5,  5, 10, 25, 25, 10,  5,  5,
            0,  0,  0, 20, 20,  0,  0,  0,
            5, -5,-10,  0,  0,-10, -5,  5,
            5, 10, 10,-20,-20, 10, 10,  5,
            0,  0,  0,  0,  0,  0,  0,  0
        ];
        this.KNIGHT_TABLE = [
            -50,-40,-30,-30,-30,-30,-40,-50,
            -40,-20,  0,  0,  0,  0,-20,-40,
            -30,  0, 10, 15, 15, 10,  0,-30,
            -30,  5, 15, 20, 20, 15,  5,-30,
            -30,  0, 15, 20, 20, 15,  0,-30,
            -30,  5, 10, 15, 15, 10,  5,-30,
            -40,-20,  0,  5,  5,  0,-20,-40,
            -50,-40,-30,-30,-30,-30,-40,-50
        ];
    }

    // Bewertet ersten Sequenz-Zug für die Sortierung im Pruning
    evaluateMove(move) {
        let score = 0;
        
        // Bonuspunkte für das Schlagen von Figuren
        if (move.captured) {
            score += this.pieceValues[move.captured] || 0;
        }
        
        // Rochade-Bonus
        if (move.flags === 'k' || move.flags === 'q') {
            score += this.CASTLE_SHORT_BONUS;
        }

        // Provisorischer Zug, um zu prüfen, ob es ein Schach ist
        const tempGame = new Chess(this.game.fen()); // Erstelle eine Kopie des Spiels
        tempGame.move(move); // Führe den Zug auf der Kopie aus

        if (tempGame.inCheck()) {
            score += 1; // Bonus für Schach
        }
        // Das temporäre Spielobjekt wird am Ende der Funktion von der Garbage Collection entfernt
        
        return score;
    }

    // --- Positions-Bewertung ---
    evaluatePosition() {
        let score = 0;
        const board = this.game.board();

        // Material- und Positionsbewertung
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = board[i][j];
                if (piece) {
                    let pieceValue = this.pieceValues[piece.type];
                    let positionValue = 0;

                    // Index der Tabelle finden (für Schwarz spiegeln)
                    let tableIndex = (piece.color === 'w') ? (i * 8 + j) : ((7 - i) * 8 + j);
                    
                    // PSTs anwenden
                    if (piece.type === 'p') {
                        positionValue = this.PAWN_TABLE[tableIndex];
                    } else if (piece.type === 'n') {
                        positionValue = this.KNIGHT_TABLE[tableIndex];
                    }
                    
                    if (piece.color === 'w') {
                        score += pieceValue + positionValue;
                    } else {
                        score -= (pieceValue + positionValue);
                    }
                }
            }
        }
        
        // Belohnung für noch vorhandene Rochade-Rechte
        const fen = this.game.fen();
        const fenParts = fen.split(' ');
        const castlingRights = fenParts[2]; // Der dritte Teil des FEN-Strings

        if (castlingRights.includes('K')) { // Weiß darf kurz rochieren
            score += this.CASTLE_SHORT_BONUS;
        }
        if (castlingRights.includes('k')) { // Schwarz darf kurz rochieren
            score -= this.CASTLE_SHORT_BONUS;
        }

        return score;
    }

    // --- minimax Algorithmus ---
    minimax(depth, isMaximizingPlayer, alpha, beta) {
        // 1. Basisfall
        if (depth === 0 || this.game.isGameOver()) {
            return this.evaluatePosition();
        }

        // Züge nur einmal generieren und sortieren
        let possibleMoves = this.game.moves({ verbose: true });
        possibleMoves.sort((a, b) => this.evaluateMove(b) - this.evaluateMove(a));
        
        // 2. Maximierer (Weiß)
        if (isMaximizingPlayer) {
            let maxEval = -Infinity;
            for (let i = 0; i < possibleMoves.length; i++) {
                let move = possibleMoves[i];
                this.game.move(move);
                let evaluation = this.minimax(depth - 1, false, alpha, beta);
                this.game.undo();
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                if (beta <= alpha) { 
                    break;
                }
            }
            return maxEval;
        } 
        // 3. Minimierer (Schwarz)
        else {
            let minEval = Infinity;
            for (let i = 0; i < possibleMoves.length; i++) {
                let move = possibleMoves[i];
                this.game.move(move);
                let evaluation = this.minimax(depth - 1, true, alpha, beta);
                this.game.undo();
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                if (beta <= alpha) { 
                    break;
                }
            }
            return minEval;
        }
    }

    // Syzygy Tablebase Einbindung
    async getBestMoveFromTablebase() {
        const fen = this.game.fen().split(' ')[0];
        const pieceCount = fen.replace(/[^pbnrqkPBNRQK]/g, '').length;

        // Tablebase aktivieren ab 7 verbleibenden Figuren
        if (pieceCount <= 7) {
            const url = `https://lichess.org/api/tablebase?fen=${fen}`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                
                if (data && data.moves && data.moves.length > 0) {
                    // Finde den besten Zug aus der API-Antwort (dtz)
                    // Positiver Wert = Win in x, Negativ = Lose in x, 0 = Remis
                    // Wir wollen den Zug mit dem höchsten positiven Wert oder niedrigsten negativen
                    let bestMove = data.moves[0];
                    for (let i = 1; i < data.moves.length; i++) {
                        if (data.moves[i].dtz > bestMove.dtz) {
                            bestMove = data.moves[i];
                        }
                    }
                    
                    return bestMove.san;
                }
            } catch (error) {
                console.error("Fehler beim Abruf der Tablebase:", error);
            }
        }
        return null; // Keine Verbindung, Fallback zu Minimax
    }

    // --- Hauptfunktion makeMove ---
    async makeMove() {
        // Feste Eröffnungslogik
        const history = this.game.history();
        if (history.length === 1) {
            if (history[0] === 'e4') {
                this.game.move('e6');
                return 'e6';
            }
            if (history[0] === 'd4') {
                this.game.move('d5');
                return 'd5';
            }
            if (history[0] === 'c4') {
                this.game.move('e5');
                return 'e5';
            }
        }

        // Zuerst Tablebase prüfen
        const tablebaseMove = await this.getBestMoveFromTablebase();
        if (tablebaseMove) {
            console.log("Syzygy");
            this.game.move(tablebaseMove);
            return tablebaseMove;
        }

        // Wenn keine Tablebase-Antwort, Minimax ausführen
        const possibleMoves = this.game.moves({ verbose: true });
        
        // Dynamische Suchtiefe
        const historyLength = this.game.history().length;
        let SEARCH_DEPTH;
        if (historyLength <= 4) {
            SEARCH_DEPTH = 3;
        } else {
            SEARCH_DEPTH = 3;
        }

        let bestMove = null;
        let bestValue = Infinity;

        for (let i = 0; i < possibleMoves.length; i++) {
            let move = possibleMoves[i];
            
            // Simuliere Zug
            this.game.move(move);
            
            // Prüfung auf Matt in 1
            if (this.game.isCheckmate()) {
                this.game.undo();
                this.game.move(move);
                return move;
            }
            
            // Bewertung des Zugs durch Aufruf der Minimax-Funktion
            let moveValue = this.minimax(SEARCH_DEPTH - 1, false, -Infinity, Infinity);
            
            this.game.undo();
            
            // Boni und Mali anwenden
            if (move.flags === 'k') {
                moveValue -= this.CASTLE_SHORT_BONUS;
            }
            if (move.piece === 'n' || move.piece === 'b') {
                let fromRank = parseInt(move.from[1]);
                let toRank = parseInt(move.to[1]);
                if ((fromRank === 7 || fromRank === 8) && (toRank === 6 || toRank === 5)) {
                    moveValue -= this.DEVELOPMENT_BONUS;
                }
            }
            if (move.piece === 'q' && this.game.history().length < 4) {
                moveValue += this.QUEEN_EARLY_MOVE_PENALTY;
            }
            if (move.piece === 'p' && move.from === 'f7' && (move.to === 'f6' || move.to === 'f5')) {
                moveValue += this.BAD_PAWN_MOVE_PENALTY;
            }
            if (move.piece === 'p' && (move.from === 'g7' || move.from === 'g6') && move.to === 'g5') {
                moveValue += this.PAWN_ADVANCE_PENALTY;
            }
            if (move.piece === 'k' && move.flags !== 'k') {
                moveValue += this.KING_MOVE_PENALTY;
            }
            if (move.flags.includes('p')) {
                moveValue -= (this.pieceValues['q'] - this.pieceValues['p']); 
            }

            // Zufälligkeit
            moveValue += Math.random() * 0.1;

            // Wähle den besten Zug
            if (moveValue < bestValue) {
                bestValue = moveValue;
                bestMove = move;
            }
        }

        if (bestMove === null) {
            console.error("Ohana ist überlastet");
            const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            this.game.move(randomMove);
            return randomMove;
        }
        this.game.move(bestMove);
        return bestMove;
    }
}
// --- Ende der Engine ---

// vars
var board = null;
var game = new Chess(); // Initialisiert ein neues Schachspiel
var $status = $('#status');
var $fen = $('#fen');
var $pgn = $('#pgn');

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

    // Versuche den Zug im try-Block
    try {
        move = game.move({
            from: source,
            to: target,
            promotion: 'q' // Immer 'Dame' für die Promotion
        });
    } catch (error) {
        // Zug war ungültig - 'snapback' zurück
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
async function makeComputerMove() {
    // Sicherstellen, dass der Computer wirklich am Zug ist
    if (game.turn() === 'b') { // Computer ist Schwarz
        await window.computerEngine.makeMove(); // **WICHTIG: await hinzugefügt**
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

    // FEN-Code in der Konsole ausgeben
    console.log(game.fen());
    
    $('#status').html(status);
    $('#fen').html(game.fen());
    $('#pgn').html(game.pgn());

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
                    // Zeilen 7-0 (8-1), Spalten a-h
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
            status += ', ' + moveColor + ' steht im Schach'; 
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
