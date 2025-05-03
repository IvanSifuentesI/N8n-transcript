const express = require('express');
const axios = require('axios');
// --- Cambio de Importación ---
const { YoutubeTranscript } = require('youtube-transcript'); // Nueva librería

const app = express();
const port = process.env.PORT || 3000; // Puerto estándar de Replit

// Lee la API Key desde Secrets/Variables de Entorno
const API_KEY = process.env.YOUTUBE_API_KEY; // Nombre de tu Secret

if (!API_KEY) {
    console.warn("ADVERTENCIA: YOUTUBE_API_KEY no configurada en Secrets/Entorno. Obtención de metadatos fallará.");
} else {
    console.log("API Key de YouTube cargada.");
}

app.use(express.json()); // Middleware para parsear JSON bodies

/**
 * Obtiene los metadatos (título, descripción, URL de miniatura) de un video.
 * (Esta función no cambia)
 * @param {string} videoId - El ID del video de YouTube.
 * @returns {Promise<object>} Objeto con { title, description, thumbnailUrl } o lanza error.
 */
async function getVideoMetadata(videoId) {
    if (!API_KEY) {
        console.error("Error en getVideoMetadata: API Key no configurada.");
        throw new Error("Error de configuración del servidor: API Key de YouTube no está definida.");
    }
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
    try {
        console.log(`Obteniendo metadatos para video ID: ${videoId}`);
        const response = await axios.get(url);
        if (response.data.items && response.data.items.length > 0) {
            const snippet = response.data.items[0].snippet;
            let thumbnailUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null;
            console.log(`Metadatos obtenidos: Título - ${snippet.title}, Thumbnail - ${thumbnailUrl ? 'Encontrada' : 'No encontrada'}`);
            return {
                title: snippet.title,
                description: snippet.description,
                thumbnailUrl: thumbnailUrl
            };
        } else {
            throw new Error(`Video con ID ${videoId} no encontrado o sin datos via API.`);
        }
    } catch (error) {
        console.error(`Error al obtener metadatos para video ${videoId}:`, error.response ? error.response.data : error.message);
        if (error.response) {
            if (error.response.status === 404) throw new Error(`Video con ID ${videoId} no encontrado (API 404).`);
            if (error.response.status === 403) {
                const apiErrorMessage = error.response.data?.error?.message || "Razón desconocida";
                throw new Error(`Error API Key YouTube (403: ${apiErrorMessage}). Verifica clave/cuota/permisos.`);
            }
            const apiError = error.response.data?.error?.message || error.message;
            throw new Error(`Error API YouTube (${error.response.status}) obteniendo metadatos: ${apiError}`);
        } else if (error.request) {
            throw new Error(`Error de red conectando a YouTube API (metadatos): ${error.message}`);
        } else {
            throw new Error(`Error inesperado preparando solicitud de metadatos: ${error.message}`);
        }
    }
}

// ===========================================================
//  NUEVA FUNCIÓN fetchTranscript USANDO youtube-transcript
// ===========================================================
/**
 * Intenta obtener la transcripción completa del video usando youtube-transcript.
 * Prueba primero en español ('es'), luego en inglés ('en').
 * @param {string} videoId - El ID del video de YouTube.
 * @returns {Promise<string>} La transcripción concatenada o lanza error.
 */
async function fetchTranscript(videoId) {
    console.log(`Intentando obtener transcripción para video ID: ${videoId} con youtube-transcript`);
    const primaryLang = 'es';
    const fallbackLang = 'en';

    try {
        // Intenta obtener la transcripción en el idioma primario ('es')
        console.log(`Intentando idioma '${primaryLang}' con youtube-transcript`);
        const transcriptDataEs = await YoutubeTranscript.fetchTranscript(videoId, { lang: primaryLang });

        // Si tiene éxito y devuelve datos, procesa y retorna
        if (transcriptDataEs && transcriptDataEs.length > 0) {
            const transcriptText = transcriptDataEs.map(item => item.text).join(' ');
            console.log(`Transcripción en '${primaryLang}' generada (longitud: ${transcriptText.length})`);
            return transcriptText;
        } else {
            // Si devuelve un array vacío, considéralo como no encontrado para 'es'
            console.warn(`youtube-transcript devolvió datos vacíos para '${primaryLang}'. Intentando '${fallbackLang}'.`);
            throw new Error(`No transcript data found for lang: ${primaryLang}`); // Lanza error para pasar al catch
        }

    } catch (errEs) {
        // Si falló 'es', loguea el error detallado e intenta con 'en'
        console.error(`Error DETALLADO al buscar subtítulos en '${primaryLang}' con youtube-transcript:`, errEs);
        console.warn(`Subtítulos en '${primaryLang}' no encontrados/error (${errEs.message}). Intentando '${fallbackLang}'.`);

        try {
            // Intenta obtener la transcripción en el idioma de respaldo ('en')
            console.log(`Intentando idioma '${fallbackLang}' con youtube-transcript`);
            const transcriptDataEn = await YoutubeTranscript.fetchTranscript(videoId, { lang: fallbackLang });

            // Si tiene éxito y devuelve datos, procesa y retorna
            if (transcriptDataEn && transcriptDataEn.length > 0) {
                const transcriptText = transcriptDataEn.map(item => item.text).join(' ');
                console.log(`Transcripción en '${fallbackLang}' generada (longitud: ${transcriptText.length})`);
                return transcriptText;
            } else {
                 // Si devuelve un array vacío para 'en' también, lanza error final
                console.error(`youtube-transcript devolvió datos vacíos también para '${fallbackLang}'.`);
                 throw new Error(`No transcript data found for lang: ${fallbackLang}`);
            }

        } catch (errEn) {
            // Si falló también 'en', loguea el error detallado y lanza un error final
            console.error(`Error DETALLADO al buscar subtítulos en '${fallbackLang}' con youtube-transcript:`, errEn);
            console.error(`Fallo al obtener subtítulos también en '${fallbackLang}' para ${videoId}: ${errEn.message}`);
            // Construye el mensaje final
            let finalErrorMessage = `Transcripción no disponible para '${videoId}' usando youtube-transcript.`;
            if (errEs?.message) finalErrorMessage += ` (Err ${primaryLang}: ${errEs.message})`;
            if (errEn?.message) finalErrorMessage += ` (Err ${fallbackLang}: ${errEn.message})`;
            throw new Error(finalErrorMessage);
        }
    }
}
// ===========================================================
//                FIN NUEVA FUNCIÓN fetchTranscript
// ===========================================================

/**
 * Endpoint para obtener info (título, desc, miniatura, transcripción) por ID.
 * POST /video-info-by-id
 * Body: { "videoId": "VIDEO_ID" }
 * (Esta función no cambia su lógica principal)
 */
app.post('/video-info-by-id', async (req, res) => {
    const { videoId } = req.body;

    if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
        return res.status(400).json({ error: "'videoId' requerido en el cuerpo JSON." });
    }
    const youtubeIdRegex = /^[a-zA-Z0-9_-]{11}$/;
    if (!youtubeIdRegex.test(videoId)) {
         console.warn(`El videoId '${videoId}' no coincide con formato estándar.`);
    }

    console.log(`Recibida solicitud para procesar video ID: ${videoId}`);

    try {
        // Llama a las funciones actualizadas
        const [metadata, transcript] = await Promise.all([
            getVideoMetadata(videoId),
            fetchTranscript(videoId) // Usa la nueva función con youtube-transcript
        ]);

        return res.json({
            videoId: videoId,
            title: metadata.title,
            description: metadata.description,
            thumbnailUrl: metadata.thumbnailUrl,
            transcript: transcript,
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`
        });

    } catch (error) {
        // Manejo de errores centralizado (igual que antes, captura errores de ambas funciones)
        console.error(`Error GRAL procesando video ID ${videoId}:`, error.message);
        let statusCode = 500;
        let publicErrorMessage = error.message || `Error interno procesando video ID ${videoId}.`;

        // Ajustar código de estado basado en palabras clave del error
        if (publicErrorMessage.includes("API Key") || publicErrorMessage.includes("403")) {
            statusCode = 403;
        } else if (publicErrorMessage.includes("no encontrado") || publicErrorMessage.includes("404") || publicErrorMessage.includes("Could not find transcript")) { // Añadir posible error de youtube-transcript
            statusCode = 404;
        } else if (publicErrorMessage.includes("Transcripción no disponible")) {
            statusCode = 404;
        } else if (publicErrorMessage.includes("Error de red")) {
             statusCode = 503;
        } else if (publicErrorMessage.includes("Error de configuración")) {
             statusCode = 500;
        }
        return res.status(statusCode).json({ error: publicErrorMessage, videoId: videoId });
    }
});

// Endpoint raíz (sin cambios)
app.get('/', (req, res) => {
    res.send('Servicio Transcripción YouTube (por ID) v3 [youtube-transcript]. Usa POST /video-info-by-id con { "videoId": "..." }');
});

// Iniciar servidor (sin cambios)
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port} o la URL pública de Replit.`);
    if (!API_KEY) {
        console.warn("ADVERTENCIA: Servidor iniciado SIN API Key de YouTube. Obtención de metadatos fallará.");
    }
});