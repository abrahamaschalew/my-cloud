(function () {

    var doc = document.documentElement;
    var w = window;

    var prevScroll = w.scrollY || doc.scrollTop;
    var curScroll;
    var direction = 0;
    var prevDirection = 0;

    var header = document.getElementById('nav-body');

    var checkScroll = function () {

        const mediaQ = window.matchMedia("(max-width: 900px)");

        if (mediaQ.matches) return;
        /*
        ** Find the direction of scroll
        ** 0 - initial, 1 - up, 2 - down
        */

        curScroll = w.scrollY || doc.scrollTop;
        if (curScroll > prevScroll) {
            //scrolled up
            direction = 2;
        }
        else if (curScroll < prevScroll) {
            //scrolled down
            direction = 1;
        }

        if (direction !== prevDirection) {
            toggleHeader(direction, curScroll);
        }

        prevScroll = curScroll;
    };

    var toggleHeader = function (direction, curScroll) {
        if (direction === 2 && curScroll > 52) {

            //replace 52 with the height of your header in px

            header.classList.add('hide');
            prevDirection = direction;
        }
        else if (direction === 1) {
            header.classList.remove('hide');
            prevDirection = direction;
        }
    };

    window.addEventListener('scroll', checkScroll);

    document.querySelector('.bar').addEventListener('click', () => {
        document.querySelector('.menu-list').classList.toggle('show');
        document.querySelector('.close').classList.toggle('show');
        document.querySelector('.bar').classList.toggle("show-none");
    })


    document.querySelector('.close').addEventListener('click', () => {
        document.querySelector('.menu-list').classList.toggle('show');
        document.querySelector('.close').classList.toggle('show');
        document.querySelector('.bar').classList.toggle("show-none");
    })

})();



function scrollSection(elementClass) {

    // check if it's mobile. if it's close the view after clicked
    const mediaQ = window.matchMedia("(max-width: 900px)");
    if (mediaQ.matches) {
        document.querySelector('.menu-list').classList.toggle('show');
        document.querySelector('.close').classList.toggle('show');
        document.querySelector('.bar').classList.toggle("show-none")
    }


    setTimeout(() => {
        document.querySelector(`.${elementClass}`).scrollIntoView({
            behavior: 'smooth'
        })
    }, 1)
}
