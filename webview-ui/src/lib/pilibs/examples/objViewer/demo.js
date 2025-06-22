"use strict"

function Demo( canvasName )
{
    var me = this;

    this.mCreated = false;
    this.mCanvas = document.getElementById( canvasName );

    this.mXres = this.mCanvas.offsetWidth/1;
    this.mYres = this.mCanvas.offsetHeight/1;
    this.mRatio = this.mXres / this.mYres;

    this.mCanvas.width = this.mXres;
    this.mCanvas.height = this.mYres;

    this.mGL = piCreateGlContext(this.mCanvas, false, true, false, false);
    if( this.mGL == null )
        return;

    console.log( "Rendering at " + this.mXres + " x " + this.mYres );

    this.mRenderer = new piRenderer();

    if( !this.mRenderer.Initialize(  this.mGL  ) )
        return;

    // control
    this.mPaused = false;
    this.mFrame = 0;
    this.mFpsFrame = 0;
    this.mFpsTo = null;
    this.mTo = 0;
    this.mTf = 0;
    this.mFpsTo = this.mTo;


    //--------------------------------------------------------------------
    this.mPiece = new svPiece();

    if( !this.mPiece.init( this.mRenderer, this.mXres, this.mYres ) )
    {
        alert("Couldn't initialize demo");
        return;
    }

    this.mCreated = true;
}

Demo.prototype.startRendering = function ()
{
    var me = this;

    me.mTo = getRealTime();

    function dorender()
    {
        var time = getRealTime();
        var ltime = time - me.mTo;

        me.mPiece.GlobalRender( me.mRenderer, ltime/1000.0, null );
        me.mPiece.EyeRender( me.mRenderer, null );

        me.mFpsFrame++;
        me.mFrame = Math.floor(ltime * 60.0/1000.0);
        document.getElementById("myFrame").innerHTML = "F" + me.mFrame;
        document.getElementById("myTime").innerHTML = (ltime / 1000.0).toFixed(2) + " s";
        if( (time-me.mFpsTo)>1000 )
        {
            var ffps = 1000.0 * me.mFpsFrame / (time-me.mFpsTo);
            document.getElementById("myFramerate").innerHTML = ffps.toFixed(1) + " fps";
            me.mFpsFrame = 0;
            me.mFpsTo = time;
        }
        if( !me.mPaused )
            requestAnimFrame( dorender, null );
    }

    requestAnimFrame( dorender, null );
}


Demo.prototype.pauseResume = function ()
{
    this.mPaused = !this.mPaused;

    if (!this.mPaused)
        this.startRendering();
}

